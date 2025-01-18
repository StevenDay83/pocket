process.env.standalone = true;
const EmbeddedRelay = require('./relay/relay.js');
const WSRelay = require('./relay/WSRelayFrontEnd.js');
const HyperswarmFrontEnd = require('./relay/HyperswarmFrontEnd.js');
const crypto = require('hypercore-crypto');
const b4a = require('b4a');
const commandLineArguments = require('command-line-args');
const commandLineUsage = require('command-line-usage');

const databasePrefix = './database';
const definitions = [
    {name:'hostname', type:String, defaultValue: '127.0.0.1'},
    {name:'port', alias:'p', type:Number, defaultValue:80},
    {name:'dbpath', type:String, defaultValue: databasePrefix},
    {name:'help', alias: 'h', type:Boolean},
    {name:'persistentdb', type:Boolean},
    {name:'p2p', type:Boolean},
    {name:'p2pkey', type:String, defaultValue:b4a.toString(crypto.randomBytes(32), 'hex')},
    {name:'p2pcache', type:String, defaultValue: databasePrefix + '/' + 'hcbase'},
    {name:'verbose', alias:'v', type:Boolean}

];

const sections = [
    {
      header: 'Pocket Relay',
      content: 'Lightweight Nostr Relay for local and p2p usage'
    },
    {
      header: 'Relay Options',
      optionList: [
        {
            name: 'hostname',
            typeLabel: '{underline hostname}',
            description: 'Bind relay hostname. Default is 127.0.0.1'
        },
        {
            name: 'port',
            typeLabel: '{underline port}',
            description: 'Set relay listening port. Default is 80'
        },
        {
            name: 'dbpath',
            typeLabel: '{underline directory}',
            description: 'Set location for local relay database. Default is ' + databasePrefix
        },
        {
            name: 'persistentdb',
            type: Boolean,
            description: 'Retain relay database. If not set database will be wiped upon start'
        },
      ]
    },
    {
        header: 'P2P Options',
        optionList: [
            {
                name: 'p2p',
                type: Boolean,
                description: 'Run in P2P mode. Uses Hyperswarm DHT to connect to peers.'
            },
            {
                name: 'p2pkey',
                typeLabel: '{underline string hex key}',
                description: 'Set Hyperswarm "Topic" Key. If none is specified a random one will be set.'
            },
            {
                name: 'p2pcache',
                typeLabel: '{underline directory}',
                description: 'Location for Hypercore P2P databases. Default location is ' + databasePrefix + '/' + 'hcbase'
            },
        ]
    },
    {
        header:'Misc',
        optionList:[
            {
                name: 'help',
                alias: 'h',
                type: Boolean,
                description: 'Print this usage guide.'
            },
            {
                name: 'verbose',
                alias: 'v',
                type: Boolean,
                description: 'Verbose output'
            }
        ]
    }
];

function _isStandAlone() {
    return process.env.standalone == 'true';
}

function _isVerbose(){
    return process.env.pocketVerbose == 'true';
}

try {
    var CLISettings = commandLineArguments(definitions);

    // Set global settings

    if (CLISettings.help){
        printCLIDescription(0, "Help");
    }

    process.env.pocketPersistentDB = CLISettings.persistentdb ? true : false;
    process.env.pocketP2P = CLISettings.p2p ? true : false;
    process.env.pocketVerbose = CLISettings.verbose;

    if (CLISettings.hostname){
        process.env.pocketHostname = CLISettings.hostname;
    } else {
        printCLIDescription(1, "Invalid hostname");
    }

    if (CLISettings.port && typeof(CLISettings.port) === 'number' && CLISettings.port >= 0 && CLISettings.port < 65535){
        process.env.pocketPort = CLISettings.port;
    } else {
        printCLIDescription(1, "Invalid port");
    }

    if (CLISettings.dbpath && typeof(CLISettings.dbpath) === 'string'){
        process.env.pocketDBPath = CLISettings.dbpath;
    } else {
        printCLIDescription(1, "Invalid Database Path");
    }

    if (CLISettings.p2p) {
        if (CLISettings.p2pkey && typeof(CLISettings.p2pkey) === 'string' && CLISettings.p2pkey.length == 64){
            process.env.pocketP2PKey = CLISettings.p2pkey;
        } else {
            printCLIDescription(1, "Invalid Topic Key: Must be 64 characters hexadecimal");
        }

        if (CLISettings.p2pcache && typeof(CLISettings.p2pcache) === 'string'){
            process.env.pocketP2PCache = CLISettings.p2pcache;
        } else {
            printCLIDescription(1, "Invalid P2P Cache Location");
        }
    }


} catch (cliError){
    printCLIDescription(1, cliError.message);

}

function printCLIDescription (exitcode, message) {
    const usage = commandLineUsage(sections);
    
    console.error(message);
    console.log(usage);
    process.exit(exitcode);
}

// import { test } from './module.js';

// node index.js -q --limit 1 | websocat -n wss://nos.lol | jq -rc "[.[0],.[2]]" | websocat -n ws://localhost:8080
// TODO: Relay insert and listener needs to pass in a SOURCE 
// Listeners can discern or ignore event insertion from a certain Source
// Hypercore can then ignore events from other hypercores 
// And keep hypercore logs separate, no duplicates

// var myRelay = new EmbeddedRelay.Relay();
// Testing Swarm Key a931d76b9f86c9a5c6be7c9e485eb0c90d42bc545c87d63e5cdda1452f64f957

const verbose = process.env.pocketVerbose;


var myRelay = new EmbeddedRelay(process.env.pocketPersistentDB == true, {localDb : process.env.pocketDBPath});
var netRelay = new WSRelay(myRelay, {Host: process.env.pocketHostname, Port:Number(process.env.pocketPort)});

_isStandAlone() ? console.log("Pocket Relay v0.1") : void(0);

_isStandAlone() ? console.log("Starting relay server...") : void(0);

netRelay.startServer((err) => {
    if (!err){
        _isStandAlone() ? console.log("Relay successfully started!") : void(0);
        
        if (process.env.pocketP2P == 'true'){
            _isStandAlone() ? console.log("Initializing P2P network...") : void(0);

            var hyperSwarm = new HyperswarmFrontEnd(myRelay, process.env.pocketP2PKey, process.env.pocketP2PCache ? {BaseHyperCoreDirectory : process.env.pocketP2PCache} : undefined);

            _isStandAlone() ? console.log("Setting up P2P cache...") : void(0);
            hyperSwarm.initializeCores((err, coreCount) => {
                if (!err){
                    _isStandAlone() ? console.log("Cache initialized.") : void(0);
                    // Verbose: Number of cores loaded

                    _isStandAlone() ? console.log("Loading relay events from Local P2P Cache...") : void(0);
                    hyperSwarm.importEventsFromLocalHyperCore((err) => {
                        if (!err) {
                            _isStandAlone() ? console.log("Local P2P cache loaded!") : void(0);

                            // Verbose: Cache listening for new events
                            _isStandAlone() && _isVerbose() ? console.log("Listening for new events from peers...") : void(0);
                            hyperSwarm.listenForEvents();

                            _isStandAlone() ? console.log("Connecting to P2P discovery network...") : void(0);
                            hyperSwarm.connectToGossipSwarm((err, discoveryKey) => {
                                if (!err){
                                    _isStandAlone() ? console.log("Successfully connected to ", discoveryKey) : void(0);

                                } else {
                                    _isStandAlone() ? console.log("Error connecting to P2P discovery network: ", err.message) : void(0);
                                    //Verbose full error
                                }
                            });
                            // Verbose: Connecting to Hypercores

                            _isStandAlone() ? console.log("Intializing data sync with peers...") : void(0);
                            hyperSwarm.connectHyperCoreSwarms((err) => {
                                if (!err){
                                    _isStandAlone() ? console.log("Data sync peering in progress...") : void(0);
                                } else {
                                    _isStandAlone() ? console.log("Error initializing peering: ", err.message) : void(0);
                                }
                            });
                        } else {
                            _isStandAlone() ? console.log("Error loading local P2P Cache: ", err.message) : void(0);
                            // Verbose full errors
                            process.exit(1);
                        }
                    });
                } else {
                    _isStandAlone() ? console.log("P2P Cache error: ", err.message) : void(0);
                    _isStandAlone() && _isVerbose() ? console.error(JSON.stringify(err.stack)) : void(0);
                    _isStandAlone() ? console.log("Exiting...") : void(0);
                    // Verbose full errors
                    process.exit(1);
                }
            });
            
        }

    } else {
        _isStandAlone() ? console.log("Error starting relay:", err.message) : void(0);
        _isStandAlone() && _isVerbose() ? console.error(err) : void(0);
        _isStandAlone() ? console.log("Exiting...") : void(0);

        process.exit(1);
    }
})

// var swarmKey = 'a931d76b9f86c9a5c6be7c9e485eb0c90d42bc545c87d63e5cdda1452f64f957'
// var hyperSwarm = new HyperswarmFrontEnd(myRelay, process.env.pocketP2PKey);

// netRelay.startServer((err) => {
//     if (!err){
//         console.log("Net Relay Started");

//         hyperSwarm.initializeCores((err, coreCount) => {
//             if (!err){
//                 console.log("Initialized", coreCount, "cores");
//                 hyperSwarm.importEventsFromLocalHyperCore((err) => {
//                     // console.log("How many times");
//                     console.log("Imported events into Relay");
//                     console.log("Listening for new events...");
//                     hyperSwarm.listenForEvents();
//                     hyperSwarm.connectToGossipSwarm((err, swarmKey) => {
//                         if (!err){
//                             console.log("Connected to Gossip Swarm", swarmKey);
//                         } else {
//                             console.log(e);
//                         }
//                     });
//                     hyperSwarm.connectHyperCoreSwarms((err) => {
//                         console.log("Hypercore swarms connected");
//                     });
//                 });
//             }
//         });
//     } else {
//         console.log(err);
//     }

// });