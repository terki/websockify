var Service = require('node-windows').Service;
var path = require('path');
var argv = require('optimist').argv;

// Create a new service object
var svc = new Service({
	name: 'websockify',
	description: 'Websockify proxy service',
	script: path.join(__dirname, 'websockify.js'),
	env: [{
		name: 'NODE_ENV',
		value: process.env.NODE_ENV
	},
	{
		name: 'ARGS',
		value: process.argv.slice(2)
	}]
});

// Listen for the "install" event, which indicates the
// process is available as a service.
svc.on('install', function() {
	svc.start();
});

if (argv.help || argv.h) {
	console.log('Usage: [--uninstall] [params...]');
}
else if (argv.uninstall) {
	svc.uninstall();
}
else {
	svc.install();
}

