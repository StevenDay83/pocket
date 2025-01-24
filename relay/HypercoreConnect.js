const Hypercore = require('hypercore');
const Hyperswarm = require('hyperswarm');
const b4a = require('b4a');
const { _isStandAlone, _isVerbose } = require('../environment.js');

class HypercoreConnect {
    constructor(){
        this.LocalHyperCoreSwarm;
        this.LocalHyperCore;
        this.ReadableHyperCoreSwarms = {};
        this.coreUpdateListeners = {};
    }

    setLocalHyperCore(localHyperCore){
        if (localHyperCore && localHyperCore.writable){
            this.LocalHyperCore = localHyperCore;
        }
    }

    insertReadableHyperCores(readableHyperCoreList){
        if (readableHyperCoreList && Array.isArray(readableHyperCoreList)){
            for (var i = 0; i < readableHyperCoreList.length; i++){
                this.ReadableHyperCoreSwarms[b4a.toString(readableHyperCoreList[i].key, 'hex')] = [readableHyperCoreList[i], new Hyperswarm()];
            }
        }
    }

    initializeLocalHyperCoreSwarm(callback){
        if (this.LocalHyperCore && this.LocalHyperCore.discoveryKey){
            this.LocalHyperCoreSwarm = new Hyperswarm();

            this.LocalHyperCoreSwarm.on('connection', (localConn) => {
                this.LocalHyperCore.replicate(localConn);
                _isStandAlone() ? 
                console.log("Local HyperCore (" + b4a.toString(this.LocalHyperCore.key,'hex') +"): Received connection from peer (" + b4a.toString(localConn.remotePublicKey, 'hex') + ")") :
                void(0);

                localConn.once('close', () => {
                    _isStandAlone() ? console.log("Local Hypercore ("+ b4a.toString(this.LocalHyperCore.key,'hex') + "): Connection closed from peer (" + b4a.toString(localConn.remotePublicKey, 'hex') + ")")
                    : void(0);
                    
                });

                localConn.on('error', (err) => {
                    _isVerbose() ? console.error("Error :", err) : void(0);
                    _isStandAlone() ? console.error("Local Hypercore (" + b4a.toString(this.LocalHyperCore.key,'hex') + "): Connection error -", err.message) : void(0);
                });

            });

            var discovery = this.LocalHyperCoreSwarm.join(this.LocalHyperCore.discoveryKey, {client: true, server: true});

            discovery.flushed().then(() => {
                _isStandAlone() ? console.log("Data sync network for Local Core started!") : void(0);
                callback(undefined);
            });
        }
    }

    addReadableHyperCoreSwarm(thisCore, thisSwarm = new Hyperswarm(), callback){
        if (thisCore && thisSwarm){
            this.ReadableHyperCoreSwarms[b4a.toString(thisCore.key, 'hex')] = thisSwarm;
            var currentCoreLength = thisCore.length;

            thisCore.on('append', () => {
                // var currentCoreLength = thisCore.length;

                if (thisCore.length > currentCoreLength){
                    var count = currentCoreLength;

                    for (var i = currentCoreLength; i < thisCore.length; i++){
                        thisCore.get(i).then((data) => {
                            this._sendToListeners(b4a.toString(thisCore.key, 'hex'), data);

                            count++;

                            if (count == thisCore.length){
                                currentCoreLength = thisCore.length;
                            }
                        });
                    }
                }
            });

            thisSwarm.on('connection', async (conn) => {
                thisCore.replicate(conn);
                await thisCore.update();
                await thisCore.download({linear: true});

                _isStandAlone() ? console.log("Remote Hypercore ("+ b4a.toString(thisCore.key,'hex') +"): Received connection from peer (" + b4a.toString(conn.remotePublicKey, 'hex') + ")") :
                void(0);

                conn.once('close', () => {
                    _isStandAlone() ? console.log("Remote Hypercore (" + b4a.toString(thisCore.key,'hex') + "): Connection closed from peer (" + b4a.toString(conn.remotePublicKey, 'hex') + ")") :
                    void(0);
                });

                conn.on('error', (err) => {
                    _isStandAlone() ? console.error("Remote Hypercore" + b4a.toString(thisCore.key,'hex') + ": Connection error -", err.message) : void(0);
                    _isVerbose() ? console.error("Error :", err) : void(0);
                });
            });

            var discovery = thisSwarm.join(thisCore.discoveryKey, {client: true, server:true});

            discovery.flushed().then(() => {
                // console.log("Hyperswarm for Readable Core", b4a.toString(thisCore.key, 'hex'), "started");
                _isStandAlone() ? console.log("Connected to Remote Core network (" + b4a.toString(thisCore.key, 'hex') +")") : void(0);

                callback(undefined, thisSwarm);
            })
        } else {
            callback(new Error("Invalid Hypercore"));
        }
    }

    initializeReadableHyperCoreSwarms(callback) {
        var readableHyperCoreSwarmList = Object.values(this.ReadableHyperCoreSwarms);
        
        var readableCoreCount = 0;
        if (readableHyperCoreSwarmList.length > 0){
            for (var i = 0; i < readableHyperCoreSwarmList.length; i++){
                // TODO: Error checking
                var thisCore = readableHyperCoreSwarmList[i][0];
                var thisSwarm = readableHyperCoreSwarmList[i][1];
                var currentCoreCount = thisCore.length;

                this.addReadableHyperCoreSwarm(thisCore, thisSwarm, (err) => {
                    readableCoreCount++;
                    if (!err){
                        if (readableCoreCount == readableHyperCoreSwarmList.length){
                            callback(undefined);
                        }
                    } else {
                        callback(err);
                    }
                });

                // thisCore.on('append', () => {
                //     console.log("Appending to Readable Core", b4a.toString(thisCore.key, 'hex'));
                //     if (thisCore.length > currentCoreCount){
                //         // Send to a listener
                //         var count = currentCoreCount;
                //         for (var j = currentCoreCount; j < thisCore.length; j++){
                //             thisCore.get(j).then((data) => {
                //                 // console.log("Block", j, "has", data);
                //                 this._sendToListeners(b4a.toString(thisCore.key, 'hex'), data);

                //                 count++;
                //                 if (count == thisCore.length){
                //                     currentCoreCount = thisCore.length;
                //                 }
                //             });
                //         }
                //     }
                // });

                // thisSwarm.on('connection', async (readableConn) => {
                //     thisCore.replicate(readableConn);
                //     console.log("Current Length for", b4a.toString(thisCore.key, 'hex'), "is", thisCore.length);
                //     await thisCore.update();
                //     console.log("New Length for", b4a.toString(thisCore.key, 'hex'), "is", thisCore.length);
                //     await thisCore.download({start:0,end:-1});

                //     console.log("Remote Hypercore: Received connection from ", b4a.toString(readableConn.remotePublicKey, 'hex'));

                //     readableConn.once('close', () => {
                //         console.log("Remote Hypercore: Connection closed from ", b4a.toString(readableConn.remotePublicKey, 'hex'));
                //     });
    
                //     readableConn.on('data', (inData) => {
                //         // console.log("Data Incoming!!!!!!12345!!!!", inData.toString());
                //     });
    
                //     readableConn.on('error', (err) => {
                //         console.log("Error :", err);
                //     });
    
    
                // });
                
                // var discovery = thisSwarm.join(thisCore.discoveryKey, {client:true, server:true});
    
                // discovery.flushed().then(() => {
                //     readableCoreCount++;
                //     console.log("Hyperswarm for Readable Core", b4a.toString(readableHyperCoreSwarmList[readableCoreCount-1][0].key, 'hex'), "started");
    
                //     if (readableCoreCount == readableHyperCoreSwarmList.length){
                //         callback(undefined);
                //     }
                // });
            }
        } else {
            callback(undefined);
        }
    }

    addCoreUpdateListener(id, listener){
        if (id && typeof(id) === 'string' && listener && typeof(listener) === 'function'){
            this.coreUpdateListeners[id] = listener;
        }
    }

    removeCoreUpdateListener(id){
        if (id && typeof(id) === 'string'){
            delete this.coreUpdateListeners[id];
        }
    }

    _sendToListeners(coreKey, data){
        var listenerList = Object.values(this.coreUpdateListeners);

        for (var i = 0; i < listenerList.length; i++){
            listenerList[i](coreKey, data);
        }
    }

    _getCoreByDiscoveryKey(swarmKey){
        var foundCore;
        // Must Fix: DO NOT USE
        if (swarmKey){
            var localDiscoveryKey = b4a.toString(this.LocalHyperCore.discoveryKey, 'hex');

            if (swarmKey == localDiscoveryKey){
                foundCore = this.LocalHyperCore;
            } else {
                var readableCoreKeys = Object.keys(this.ReadableHyperCoreSwarms);
                for (var i = 0; i < readableCoreKeys.length; i++){
                    var thisReadableCoreKey = readableCoreKeys[i];

                    var thisCore = this.ReadableHyperCoreSwarms[readableCoreKeys[i]];
                    var thisCoreDiscoveryKey = thisCore.discoveryKey;

                    if (swarmKey == b4a.toString(thisCoreDiscoveryKey, 'hex')){
                        foundCore = thisCore;
                        break; 
                    }
                }
            }
        }

        return foundCore;
    }

    _getCoreKeyByDiscoveryKey(discoveryKey){
        var coreKey;

        if (discoveryKey){
            var foundCore = this._getCoreByDiscoveryKey(discoveryKey);

            if (foundCore){
                coreKey = b4a.toString(discoveryKey, 'hex');
            }
        }

        return coreKey;
    }
}

module.exports = HypercoreConnect;