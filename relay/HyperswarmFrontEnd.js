const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Hypercore = require('hypercore');
const crypto = require('hypercore-crypto');
const HyperCoreConnect = require('./HypercoreConnect.js');
const fs = require('fs');
const { _isStandAlone, _isVerbose } = require('../environment.js');
const { promiseHooks } = require('v8');


const KEY_RESPONSE_PREFIX = "CORE_KEY_UPDATE";

class HyperswarmFrontEnd {
    constructor(EmRelay, topic, Settings = {BaseHyperCoreDirectory : './database/hcbase/'}){
        this.CoreRelay = EmRelay;
        this.BaseHyperCoreDirectory = Settings.BaseHyperCoreDirectory.endsWith('/') ? 
        Settings.BaseHyperCoreDirectory : (Settings.BaseHyperCoreDirectory + '/');
        this.SwarmTopicKey = topic ? b4a.from(topic, 'hex') : crypto.randomBytes(32);
        this.Hyperswarm = {};
        this.remoteSessionTable = {};
        this.remoteSessionHyperCoreTable = {};
        this.ReadableHyperCoreList = [];
        this.LocalHyperCore = {};
        this.HyperCoreSwarmConnect = new HyperCoreConnect();
        this.gossipKeyInterval;
    }

    initializeCores(callback){
        var currentCoreDirectory = this.BaseHyperCoreDirectory + '/' + b4a.toString(this.SwarmTopicKey, 'hex') + '/';

        if (fs.existsSync(currentCoreDirectory)){

            var directoryList = fs.readdirSync(currentCoreDirectory);
            var writableCoreDirectory = '';
            var readableCoreList = [];

            for (var i = 0; i < directoryList.length; i++){
                var thisFSObj = directoryList[i];
                var thisFSObjFullPath = currentCoreDirectory + '/' + thisFSObj;

                if (fs.lstatSync(thisFSObjFullPath).isDirectory()){
                    if (thisFSObj == 'local'){
                        writableCoreDirectory = thisFSObjFullPath;
                    } else {
                        readableCoreList.push(thisFSObjFullPath);
                    }
                }
            }

            this.LocalHyperCore = new Hypercore(writableCoreDirectory != '' ? writableCoreDirectory : currentCoreDirectory + '/local/');

            for (var i = 0; i < readableCoreList.length; i++){
                var thisHyperCoreDirectory = readableCoreList[i];
                var readableHyperCore = new Hypercore(thisHyperCoreDirectory);

                this.ReadableHyperCoreList.push(readableHyperCore);
            }
        } else {
            this.LocalHyperCore = new Hypercore(currentCoreDirectory + '/local/');
        }

        this.LocalHyperCore.ready().then(() => {
            if (this.ReadableHyperCoreList.length == 0){
                callback(undefined, 1);
            } else {
                var count = 0;
                for (var i = 0; i < this.ReadableHyperCoreList.length; i++){
                    var thisHyperCore = this.ReadableHyperCoreList[i];

                    thisHyperCore.ready().then(() => {
                        count++;

                        if (count == this.ReadableHyperCoreList.length){
                            callback(undefined, count + 1);
                        }
                    });
                }
            }
        });
    }

    importEventsFromLocalHyperCore(callback){
        this.importEventsFromHyperCore(this.LocalHyperCore, 2000, (err) => {
            callback(err);
        });
    }

    async importEventsFromReadableHypercores(callback){
        if (this.ReadableHyperCoreList && this.ReadableHyperCoreList.length > 0){
            var readableHyperCoreCount = 0;
            var hypercoreBlockCount = 0;
            const promisify = require('util').promisify;
            // var p_importEventsFromHyperCore = promisify(this.importEventsFromHyperCore);

            for (var i = 0; i < this.ReadableHyperCoreList.length; i++){
                var thisReadableHyperCore = this.ReadableHyperCoreList[i];
                _isVerbose(1) ? console.log("Importing data from hypercore", b4a.toString(thisReadableHyperCore.key, 'hex') + "...") : void(0);

                // this.importEventsFromHyperCore(thisReadableHyperCore, (err) => {
                //     console.log("Reading from Remote Hypercore", readableHyperCoreCount);
                //     readableHyperCoreCount++;
                //     if (readableHyperCoreCount == this.ReadableHyperCoreList.length){
                //         callback(undefined);
                //     }
                // });

                await this.importEventsFromHyperCore(thisReadableHyperCore, 500);

                // p_importEventsFromHyperCore(thisReadableHyperCore).then((err) => {
                //     console.log("Reading from Remote Hypercore", readableHyperCoreCount);
                //     readableHyperCoreCount++;
                //     if (readableHyperCoreCount == this.ReadableHyperCoreList.length){
                //         callback(undefined);
                //     }
                // });
            }

            // this.ReadableHyperCoreList.forEach(thisReadableHyperCore => {
            //     this.importEventsFromHyperCore(thisReadableHyperCore, (err) => {
            //         console.log("Reading from Remote Hypercore", readableHyperCoreCount);
            //         readableHyperCoreCount++;
            //         if (readableHyperCoreCount == this.ReadableHyperCoreList.length){
            //             callback(undefined);
            //         }
            //     });
            // });

            // this.importEventsFromHyperCore(this.ReadableHyperCoreList[readableHyperCoreCount], (err) => {
            //     this.importEventsFromHyperCore(this.ReadableHyperCoreList[readableHyperCoreCount + 1], (err) => {
            //         if (err) {
            //             callback(undefined);
            //         }
            //     });
            // });
        } else {
            callback(undefined);
        }
        callback(undefined);
    }

    async importEventsFromHyperCore(hc, blocklimit = 0, callback){
        // Run through every Hypercore for log entries
        // Feed them into the Relay
        // Invalid event objects should be ignored

        // Start with the local hypercore
        return new Promise(async (resolve, reject) => {
            if (hc){
                var count = 0;
                if (hc.length == 0){
                    callback ? callback(undefined) : void(0);
                    return resolve(true);
                } else {
                    var blockStart = 0;

                    if (blocklimit > 0 && hc.length > blocklimit) {
                        blockStart = hc.length - 500;
                        await hc.clear(0, blockStart - 1);
                    }
                    for (var i = blockStart; i < hc.length; i++){
                        // console.log("What's i doing at", i);
                        var blockData = await hc.get(i, {wait: false});
    
                        try {
                            // if (i == 471){
                            //     console.log(JSON.parse(blockData));
                            // }
                            await this.CoreRelay.insertEvent(JSON.parse(blockData), 'core');
                            _isVerbose(4) ? console.log('In Hypercore', b4a.toString(hc.key, 'hex'), "block", i, "of", (hc.length - 1)) : void(0);
    
                        } catch (err){
                            _isVerbose(1) ? console.log("Invalid data, ignoring") : void(0);
                        }
    
                        
    
                        // hc.get(i, {wait: true}).then((data) => {
                        //     // console.log("HyperCore data for block", count, ":", data.toString());
                        //     try {
                        //         this.CoreRelay.insertEvent(JSON.parse(data), "core", (err) => {
                        //             // console.log("Inserting event");
                        //             if (err){
                        //                 // console.log("Inserted event into embedded relay");
                        //                 _isVerbose(1) ? console.log("Invalid data, ignoring") : void(0);
                        //             }
                        //             count++;
                            
                        //             console.log('In Hypercore', b4a.toString(hc.key, 'hex'), "block", count, "of", hc.length);
                        //             if (count == hc.length){
                        //                 // this.importEventsFromReadableHypercores((err) => {
                        //                 //     callback(err); // Callback when all cores are read
                        //                 // });
                        //                 callback(err);
                        //             }
                        //         });
                        //     } catch (parseError){
                        //         console.error(parseError);
                        //         console.log("Parse error, ignoring");
                        //     }
                            // count++;
                            
                            // if (count == this.LocalHyperCore.length){
                            //     callback(undefined);
                            // }
                        // });
                    }
                    callback ? callback(undefined) : void(0);
                    return resolve(true);
                }
            } else {
                callback ? callback(new Error("Hypercore not initialized")) : void(0);
                return reject(new Error("Hypercore not initialized"));
            }
        }); // Promise
    }

    importEventsFromReadableHypercoresOLD(callback){
        if (this.ReadableHyperCoreList && this.ReadableHyperCoreList.length > 0){
            var readableHyperCoreCount = 0;
            var hypercoreBlockCount = 0;
            for (var i = 0; i < this.ReadableHyperCoreList.length; i++){
                var thisReadableHyperCore = this.ReadableHyperCoreList[i];

                readableHyperCoreCount++;
                if (thisReadableHyperCore && thisReadableHyperCore.length > 0){
                    for (var j = 0; j < thisReadableHyperCore.length; j++){
                        thisReadableHyperCore.get(j, {wait:false}).then((data) => {
                            try {
                                this.CoreRelay.insertEvent(JSON.parse(data), 'core', (err) => {
                                    if (err){
                                        _isVerbose(1) ? console.log("Invalid data, ignoring") :
                                        void(0);
                                    } else {
                                        hypercoreBlockCount++;
                                        // console.log('Whoa!');
                                        console.log("Hypercore:", readableHyperCoreCount, "out of", this.ReadableHyperCoreList.length);
                                        console.log("Block:", hypercoreBlockCount, "out of ", thisReadableHyperCore.length);

                                        if (hypercoreBlockCount == thisReadableHyperCore.length &&
                                            readableHyperCoreCount == this.ReadableHyperCoreList.length
                                        ) {
                                            callback(undefined);
                                        }
                                    }
                                });
                            } catch (JSONParseError){
                                _isVerbose(1) ? console.log("Parse error, ignoring") : void(0);
                            }
                        });
                    }
                } else {
                    if (readableHyperCoreCount == this.ReadableHyperCoreList.length){
                        console.log('Early Exit?');
                        callback(undefined);
                    }
                }
            }
        } else {
            callback(undefined);
        }
    }

    connectHyperCoreSwarms(callback) {
        this.HyperCoreSwarmConnect.setLocalHyperCore(this.LocalHyperCore)
        this.HyperCoreSwarmConnect.insertReadableHyperCores(this.ReadableHyperCoreList);

        this.HyperCoreSwarmConnect.initializeLocalHyperCoreSwarm((err) => {
            // callback(err);
        });
        this.HyperCoreSwarmConnect.initializeReadableHyperCoreSwarms((err) => {
            this.HyperCoreSwarmConnect.addCoreUpdateListener("readable", (coreKey, data) => {
                try {
                    // console.log("Data Candidate", data.toString());
                    this.CoreRelay.insertEvent(JSON.parse(data), 'core', (err) => {
                        if (!err){
                            // console.log("Added Event to Relay:", data.toString());
                        } else {
                            // console.log("Error?", err);
                            // console.log(data.toString());
                        }
                    });
                } catch (e){
                    console.log("Error Here?", e);
                }
            });

            callback(err);
        });
    }

    connectToGossipSwarm(callback){
        this.Hyperswarm = new Hyperswarm();

        // try {
        this.Hyperswarm.on('connection', (hsConn) => {
            _isStandAlone() ? console.log("Received connection from peer (" + b4a.toString(hsConn.remotePublicKey, 'hex') + ")") :
            void(0);
            this._addConnection(hsConn);

            hsConn.once('close', () => {
                _isStandAlone() ? console.log("Connection closed from peer (" + b4a.toString(hsConn.remotePublicKey, 'hex') + ")") :
                void(0);
                this._removeConnection(hsConn);
            });

            hsConn.on('data', (data) => {
                // console.log(data.toString());
                this._handleData(hsConn, data.toString(), (err) => {
                    if (err){
                        _isVerbose() ? console.log("Gossip Error:", err) : void(0);
                        _isVerbose() ? console.error(err) : void(0);
                    }
                });
            });

            hsConn.on('error', (err) => {
                _isVerbose() ? console.log("Connection error: ", err.message) : void(0);
                this._removeConnection(hsConn);
            });
        });
        // } catch (error){
        //     console.log("TEST");
        //     callback(error);
        // }


        // try {
        var discovery = this.Hyperswarm.join(this.SwarmTopicKey, {client: true, server:true});

        discovery.flushed().then(() => {
            var that = this;
            this.gossipKeyInterval = setInterval(() => {
                that.broadcastHyperCoreKey();
            }, 10000)
            callback(undefined, b4a.toString(this.SwarmTopicKey, 'hex'));
        });
        // } catch (e) {
        //     callback(e);
        // }
    }

    listenForEvents(){
        this.CoreRelay.query({limit:1}, "hypercore", "hyperswarm", (context, subID, source, newEvent) => {
            if (source != "core"){
                // console.log("New Event into hyperswarm", JSON.stringify(newEvent));
                _isVerbose() ? 
                console.log("Appending new Event", newEvent.id, "into Hypercore", b4a.toString(this.LocalHyperCore.key, 'hex')) :
                void(0);
    
                this.LocalHyperCore.append(JSON.stringify(newEvent));
            } else {
                _isVerbose() ? console.log("Event", newEvent.id, "originates from hypercore peer") : void(0);
            }
        }, () => {});
    }

    _addConnection(newConnection){
        var isSuccess = false;

        if (newConnection && newConnection.remotePublicKey){
            this.remoteSessionTable[newConnection.remotePublicKey] = newConnection;
            isSuccess = true;
        }

        return isSuccess;
    }

    _removeConnection(discConnection){
        var isSuccess = false;

        if (discConnection && discConnection.remotePublicKey){
            delete this.remoteSessionTable[discConnection.remotePublicKey];
            delete this.remoteSessionHyperCoreTable[discConnection.remotePublicKey];
            isSuccess = true;
        }

        return isSuccess;
    }

    _flushConnectionTable(){
        this.remoteSessionTable = {};
        this.remoteSessionHyperCoreTable = {};
    }

    broadcastHyperCoreKey(){
        var swarmConnections = Object.values(this.remoteSessionTable);
        var stringKey = b4a.toString(this.LocalHyperCore.key, 'hex');

        for (var i = 0; i < swarmConnections.length; i++){
            var thisSwarmConnection = swarmConnections[i];

            thisSwarmConnection.write(JSON.stringify([KEY_RESPONSE_PREFIX, stringKey]));
        }
    }

    requestHyperCoreKeys(connection){

    }

    hyperCoreExists(key) {
        var isFound = false;
        var stringKey = b4a.toString(key, 'hex');

        if (b4a.toString(this.LocalHyperCore.key, 'hex') == stringKey){
            isFound = true;
        } else {
            for (var i = 0; i < this.ReadableHyperCoreList.length; i++){
                var thisReadableHyperCoreKey = this.ReadableHyperCoreList[i].key;
                var readableCoreStringKey = b4a.toString(thisReadableHyperCoreKey, 'hex');
                if (stringKey == readableCoreStringKey){
                    isFound = true;
                    break;
                }
            }
        }

        return isFound;
    }

    _handleData(connection, data, callback){
        try {
            if (connection && data){
                var JSONData = JSON.parse(data);

                // Check if this is a Key request or Key update

                if (JSONData && Array.isArray(JSONData) && JSONData.length >= 2){
                    var directive = JSONData[0];
                    var payload = JSONData[1];

                    if (directive == KEY_RESPONSE_PREFIX){
                        if (payload.length == 64) {
                            if (!this.hyperCoreExists(b4a.from(payload, 'hex'))){
                                _isVerbose() ? console.log("Hypercore ", payload, "does not exists") : void(0);

                                var currentCoreDirectory = this.BaseHyperCoreDirectory + '/' + b4a.toString(this.SwarmTopicKey, 'hex') + '/';
    
                                var hyperCoreKey = b4a.from(payload, 'hex');
                                // _isVerbose() ? console.log("Directory: ", currentCoreDirectory + '/' + payload) : void(0);
                                _isVerbose() ? console.log("New Hypercore key (" + payload + ") received. Adding to cache...") : void(0);
                                var newHyperCore = new Hypercore(currentCoreDirectory + '/' + payload, hyperCoreKey);

                                newHyperCore.ready().then(() => {
                                    this.ReadableHyperCoreList.push(newHyperCore);
                                    this.HyperCoreSwarmConnect.addReadableHyperCoreSwarm(newHyperCore, new Hyperswarm(), (err) => {
                                        callback(err);
                                    });
                                });
                            } else {
                                _isVerbose(2) ? console.log("Hypercore key advertisement: ", payload, "is already in cache. Ignoring...") : void(0);
                            }
                        } else {
                            callback(new Error("Invalid Payload"));
                        }
                    }
                } else {
                    callback(new Error("Bad gossip data from " + b4a.toString(connection.remotePublicKey, 'hex')));
                }
            }
        } catch (e) {
            callback(e);
        }
    }
}

module.exports = HyperswarmFrontEnd;