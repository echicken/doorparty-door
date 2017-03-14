const fs = require('fs');
const net = require('net');
const util = require('util');
const path = require('path');
const SSHClient = require('ssh2').Client;
const ini = require('node-ini');
const program = require('commander');

function log(msg, force) {
	if (program.debug || force) {
		fs.appendFileSync(
			path.join(__dirname, 'dpc.log'),
			JSON.stringify(msg) + '\r\n',
			'utf-8'
		);
	}
}

function initProgram() {
	program.version(
		'0.0.1'
	).option(
		'-d, --dropfile <path>', 'Path to door32.sys.'
	).option(
		'-g, --game <code>', 'Optional code of game to launch.'
	).option(
		'-s, --settings <file>', 'Optional path to settings.ini.'
	).option(
		'-p, --password <password>', 'Optional per-user RLOGIN password.'
	).option(
		'--debug', 'Debug logging, outputs to dpc.log.'
	).parse(
		process.argv
	);
	log({ msg : 'Program', data : program });
	if (typeof program.dropfile !== 'string') {
		throw 'Missing dropfile argument (-d, --dropfile <path>)';
	}
}

function loadSettings(path) {

	var settings = { ssh : {}, rlogin : {} };
	var _settings = ini.parseSync(path);

	if (typeof _settings.ssh === 'object') {
		settings.ssh.username = _settings.ssh.username || '';
		settings.ssh.password = _settings.ssh.password || '';
		settings.ssh.server = _settings.ssh.server || 'dp.throwbackbbs.com';
		settings.ssh.port = parseInt(_settings.ssh.port || 2022);
	}

	if (typeof _settings.rlogin === 'object') {
		settings.rlogin.bbs_tag = _settings.rlogin.bbs_tag || '';
		settings.rlogin.password = _settings.rlogin.password || '';
		settings.rlogin.server = _settings.rlogin.server || 'dp.throwbackbbs.com';
		settings.rlogin.port = parseInt(_settings.rlogin.port || 513);
	}

	settings.rlogin.bbs_tag = util.format(
		'[%s]', settings.rlogin.bbs_tag.replace(/\[|\]/g, '')
	);

	log({ msg : 'Settings', data: settings });
	return settings;

}

function loadDoor32(path) {

	var door32 = {
		connectionType : -1,
		connectionHandle : -1,
		baudRate : -1,
		hostSoftware : '',
		userNumber : -1,
		userName : '',
		userAlias : '',
		userSecurity : -1,
		userTime : -1,
		terminal : 0,
		nodeNumber : -1
	};

	var d32 = Object.keys(door32);

	fs.readFileSync(path, 'ascii').split(/\n/).forEach(
		(e, i, a) => {
			if (typeof door32[d32[i]] === 'number') {
				var _e = parseInt(e);
				if (isNaN(_e) || _e < 0) {
					throw 'Invalid dropfile parameter ' + d32[i] + ', ' + e;
				} else {
					door32[d32[i]] = _e;
				}
			} else {
				door32[d32[i]] = e;
			}
		}
	);

	log({ msg : 'DOOR32', data : door32 });
	return door32;

}

function getSocket(descriptor) {
	return new net.Socket(
		{	fd : descriptor,
			allowHalfOpen : false,
			readable : true,
			writable : true
		}
	);
}

function onTunnel(cfg, tunnel, sock, d32, err, stream) {

	if (err) {
		log({ msg: 'Tunnel setup error', err : err });
		tunnel.end();
		return;
	}

	stream.on('error', (err) => { log({ msg : 'Stream error', err : err }); });
	stream.on('close', () => { tunnel.end(); });
	stream.on('data', (data) => { sock.write(data); });
	stream.write(
		String.fromCharCode(0) +
		cfg.rlogin.password + String.fromCharCode(0) +
		cfg.rlogin.bbs_tag + d32.userAlias + String.fromCharCode(0) +
		(program.game || 'ansi-bbs') + '/115200' + String.fromCharCode(0),
		'ascii'
	);

	sock.on('data', (data) => { stream.write(data); });

}

function startTunnel(cfg, sock, d32, cb) {

	var tunnel = new SSHClient();
	tunnel.on('error', (err) => { log({ msg : 'Tunnel error', err : err }); });
	tunnel.on('close', () => { process.exit(0); });
	tunnel.on(
		'ready', () => {
			tunnel.forwardOut(
				'localhost', cfg.ssh.port, cfg.rlogin.server, cfg.rlogin.port,
				(e, s) => {	cb(cfg, tunnel, sock, d32, e, s); }
			)
		}
	);

	tunnel.connect(
		{	host: cfg.ssh.server,
			port: cfg.ssh.port,
			username: cfg.ssh.username,
			password: cfg.ssh.password
		}
	);

}

function main() {
	initProgram();
	var door32 = loadDoor32(program.dropfile);
	var settings = loadSettings(
		program.settings || path.join(__dirname, './settings.ini')
	);
	var socket = getSocket(door32.connectionHandle);
	startTunnel(settings, socket, door32, onTunnel);
}

try {
	main();
} catch (err) {
	log({ msg : 'Exception', err : err }, true);
}
