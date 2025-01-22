const EmbeddedRelay = require("./relay.js");
const ws = require('ws');
const NostrTools = require("nostr-tools");
const { _isStandAlone, _isVerbose } = require('../environment.js');

class WebSocketRelayFrontEnd {
    constructor (EmRelay, Settings = {Host: '127.0.0.1', Port: 8080}){
        this.WSServer;
        this.CoreRelay = EmRelay;
        this.Port = Settings.Host;
        this.WSPort = Settings.Port ? Settings.Port : 8080;
        this.socketTable = {};
    }

    startServer(callback){
        if (!this.WSServer){
            this.WSServer = new ws.Server({
                host:this.Host,
                port:this.WSPort,
                backlog:20
            },(err) => {
                if (!err){
                    this.WSServer.on('connection', (socket, req) => {
                        let remoteAddress = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
                        _isStandAlone() ? console.log("New connection from ", remoteAddress + ":" + req.socket.remotePort) : void(0);
                        this.socketTable[[remoteAddress, req.socket.remotePort]] = socket;

                        socket.on('message', (newMessage) => {
                            this._handleMessage(socket, newMessage);
                        });

                        socket.on('close', () => {
                            var socketID = [socket._socket.remoteAddress, socket._socket.remotePort];
                            this.CoreRelay.endQuery(socketID);
                            delete this.socketTable[socketID];

                            _isStandAlone() ? console.log("Connection from ", remoteAddress, " closed") : void(0);
                        });
                    });

                    this.CoreRelay.startRelay((err) => {
                        callback(err);
                    });
                } else {
                    callback(err);
                }
                // callback(undefined);
            });
        }
    }

        _handleMessage(socket, newMessage){
            try {
                // console.log(newMessage.toString());
                var newNostrMessage = JSON.parse(newMessage);
    
                if (Array.isArray(newNostrMessage) && newNostrMessage.length >= 2){
                    var nostrMessagePrefix = newNostrMessage[0];
    
                    if (nostrMessagePrefix == 'EVENT' || nostrMessagePrefix == 'REQ' || nostrMessagePrefix == 'CLOSE'){
                        switch(nostrMessagePrefix){
                            case 'EVENT': {
                                var newEvent = newNostrMessage[1];
                                var eventResponse = ['EVENT'];
    
                                if (NostrTools.verifyEvent(newEvent)){
                                    this.CoreRelay.insertEvent(newEvent, "WS", (err,returnedEvent) => {
                                        if (!err){
                                            if (returnedEvent && returnedEvent.id == newEvent.id){
                                                eventResponse.push(newEvent.id);
                                                eventResponse.push(true);
                                                eventResponse.push("");
    
                                            } else {
                                                eventResponse.push(newEvent.id);
                                                eventResponse.push(false);
                                                eventResponse.push("");
                                            }
    
                                            // socket.send("Hello");
                                            // socket.send(JSON.stringify(eventResponse));
                                            // console.log(JSON.stringify(eventResponse));
                                        } else {
                                            if (err.message.toLowerCase() == EmbeddedRelay.INSERT_EVENT_ERROR){
                                                eventResponse.push(newEvent.id ? newEvent.id : '0');
                                                eventResponse.push(false);
                                                eventResponse.push("Error: Invalid Event Sent");
                                            } else if (err.message.toLowerCase() == EmbeddedRelay.INSERT_DATABASE_ERROR){
                                                eventResponse.push(newEvent.id ? newEvent.id : '0');
                                                eventResponse.push(false);
                                                eventResponse.push("Error: Internal database error");
                                            } else {
                                                eventResponse.push(newEvent.id ? newEvent.id : '0');
                                                eventResponse.push(false);
                                                eventResponse.push("Error: Internal Error");
                                                console.error(err);
                                                // throw err;
                                            }
                                        }

                                        socket.send(JSON.stringify(eventResponse));
                                        _isVerbose(1) ? console.log(JSON.stringify(eventResponse)) : void(0);
                                    });
                                } else {
                                    throw new Error("Invalid Event");
                                }
    
                                break;
                            }
    
                            case 'REQ': {
                                if (newNostrMessage.length >= 3){
                                    var subscriptionID = newNostrMessage[1];
                                    // var newQuery = newNostrMessage[2];
                                    var newQuery = newNostrMessage.slice(2);

                                    if (subscriptionID && typeof subscriptionID === 'string' && subscriptionID.length > 0){
                                        if (newQuery && typeof newQuery === 'object'){
                                            var socketID = [socket._socket.remoteAddress, socket._socket.remotePort];
                                            this.CoreRelay.query(newQuery, socketID, subscriptionID, (context, subID, source, inEvent) => {
                                                // Listeners for new stuff
                                                // var thisSocket = this.socketTable[socketID];
                                                if (subID && inEvent && typeof inEvent === 'object'){
                                                    socket.send(JSON.stringify(["EVENT", subID, inEvent]));
                                                }
                                            }, (err, contextID, subID, eventList) => {
                                                // Bulk results
                                                if (!err){
                                                    if (subID && eventList && Array.isArray(eventList)){
                                                        for (var i = 0; i < eventList.length; i++){
                                                            var responseEvent = ["EVENT", subID, eventList[i]];
                                                            
                                                            socket.send(JSON.stringify(responseEvent));
                                                        }
                                                        socket.send(JSON.stringify(["EOSE", subID]));
                                                    } 
                                                } else {
                                                    if (err.message.toLowerCase() == EmbeddedRelay.QUERY_EVENT_ERROR){
                                                        socket.send(JSON.stringify(["CLOSED", subID, "Error: Invalid Query"]));
                                                    } else if (err.message.toLowerCase() == EmbeddedRelay.QUERY_DATABASE_ERROR){
                                                        socket.send(JSON.stringify(["CLOSED", subID, "Error: Internal Database error"]));
                                                    } else {
                                                        console.error(err);
                                                        socket.send(JSON.stringify(["CLOSED", subID, "Error: Internal error"]));
                                                    }
                                                }
                                            });
                                        }
                                    }
                                }
                                

                                break;
                            }
    
                            case 'CLOSE': {
                                if (newNostrMessage.length == 2){
                                    var subscriptionID = newNostrMessage[1];

                                    this.CoreRelay.endQuery([socket._socket.remoteAddress, socket._socket.remotePort], subscriptionID);

                                    socket.send(JSON.stringify(["CLOSED", subscriptionID]));
                                }
                            }
                        }
                    } else {
                        // Invalid Prefix
                    }
                }
            } catch (e) {
                // JSON Parse error
                if (e.name == "SyntaxError"){
                    socket.send(JSON.stringify(["CLOSED", undefined, "Error: malformed JSON"]));
                } else {
                    // Invalid command
                    socket.send(JSON.stringify(["CLOSED", undefined, "Error: Invalid Query"]));
                    _isVerbose() ? console.log(e) : void(0);
                }
            }
        }
}

module.exports = WebSocketRelayFrontEnd;