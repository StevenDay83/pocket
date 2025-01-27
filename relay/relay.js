const ws = require('ws');
const Engine = require('tingodb')();
const NostrTools = require("nostr-tools");
const fs = require('fs');

const INSERT_DATABASE_ERROR = "insert: database error";
const INSERT_EVENT_ERROR = "insert: invalid event error";
const QUERY_DATABASE_ERROR = "query: invalid event error";
const QUERY_EVENT_ERROR = "query: invalid event error";

// TODO List
// Fix limit issue with tag searching. If tag searching limit needs to be imposed manually :(
// Change order of events into created_at descending order
// Learn HyperDHT, HyperSwarm

class Relay {
    constructor(persistentDB = false, Settings = {localDb: './database2'}){
        // TODO: Set up options for temporary DB
        this.dbLocation = Settings.localDb;

        if (!fs.existsSync(this.dbLocation)){
            // Make directory
            fs.mkdirSync(this.dbLocation);
        }

        this.defaultCollection = 'RelayEvents';
        
        this.WSServer;
        this.PersistentDB = persistentDB;
        this.EmbeddedDB = new Engine.Db(this.dbLocation, {});
        this.EmbeddedDB.collection("test");
        this.EmbeddedDB.createCollection("test");

        this.querySubs = {};
    }

    startRelay (callback){    
        if (!this.PersistentDB){
            this._clearDatabase((err) => {
                callback(err);
            });
        }
        
    }

    destroyRelay(callback){
        if (!this.PersistentDB){
            this._clearDatabase((err) => {
                this.clearAllQueries();
                callback(err);
            });
        }
    }

    _clearDatabase(callback){
        if (fs.existsSync(this.dbLocation + '/' + this.defaultCollection)){
            this.relayCollection = this.EmbeddedDB.collection(this.defaultCollection).drop((err) => {
                callback(err);
            });
        } else {
            callback(undefined);
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
                                this.insertEvent(newEvent, (err,returnedEvent) => {
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
                                        socket.send(JSON.stringify(eventResponse));
                                        console.log(JSON.stringify(eventResponse));
                                    } else {
                                        throw err;
                                    }
                                });
                            } else {
                                throw new Error("Invalid Event");
                            }

                            break;
                        }

                        case 'REQ': {

                            break;
                        }

                        case 'CLOSE': {

                        }
                    }
                } else {
                    // Invalid Prefix
                }
            }

        } catch (e) {
            // JSON Parse error
            if (e.message == "something"){

            } else {
                // Invalid command
            }

            console.log(e);

        }
    }

    insertEvent(newEvent, source, callback){
        // Insert one at a time
        return new Promise((resolve,reject) => {
            var eventCollection = this.EmbeddedDB.collection(this.defaultCollection);

            if (newEvent != undefined /* && this._verifyEvent(newEvent)*/) {
                // Event is valid
                // Check for which Kind

                var thisKind = newEvent.kind;

                var regularEvent = (thisKind == 1 || thisKind == 2 || (thisKind >= 4 && thisKind < 45) || (thisKind >= 1000 && thisKind < 10000));
                var replaceableEvent = (thisKind == 0 || thisKind == 3 || (thisKind >= 10000 && thisKind < 20000));
                var ephemeralEvent = (thisKind >= 20000 && thisKind < 30000);
                var addressableReplaceable = thisKind >= 30000 && thisKind < 40000;
                var undefinedNIP01Event = thisKind >= 40000 && thisKind <= 65535; // For now treat like regular events

                if (regularEvent || undefinedNIP01Event) {
                    var eventId = newEvent.id;

                    eventCollection.findOne({ id: eventId }, { _id: 0 }, (err, result) => {
                        // If event exists just act like we wrote it
                        if (result) {
                            var cleanEvent = this._cleanEvent(newEvent);
                            // this._sendToListeners(cleanEvent);
                            callback ? callback(undefined, cleanEvent) : void(0);
                            return resolve(cleanEvent);
                        } else {
                            // Write event

                            eventCollection.insert(newEvent, (err) => {
                                if (!err) {
                                    var cleanEvent = this._cleanEvent(newEvent);
                                    this._sendToListeners(cleanEvent, source);
                                    callback ? callback(undefined, cleanEvent) : void(0);
                                    return resolve(cleanEvent);
                                } else {
                                    console.error(err);
                                    callback ? callback(new Error(INSERT_DATABASE_ERROR)) : void(0);
                                    return reject(new Error(INSERT_DATABASE_ERROR));
                                }
                            });
                        }
                    });

                } else if (replaceableEvent) {
                    var thisPubkey = newEvent.pubkey;

                    eventCollection.findOne({ pubkey: thisPubkey, kind: thisKind }, { _id: 0 }, (err, result) => {
                        // If something is found, compare time stamps. newer one gets written

                        if (result) {
                            if (result.created_at >= newEvent.created_at) {
                                callback ? callback(undefined, result) : void(0);
                                return resolve(result);
                            } else {
                                eventCollection.remove({ id: result.id }, (err, result) => {
                                    if (!err) {
                                        // console.log("Removal result: ", result);
                                        eventCollection.insert(newEvent, (err) => {
                                            if (!err) {
                                                // Broadcast new Event to any listeners
                                                var cleanEvent = this._cleanEvent(newEvent);
                                                this._sendToListeners(cleanEvent, source);
                                                callback ? callback(undefined, cleanEvent) : void(0);
                                                return resolve(cleanEvent);
                                            } else {
                                                console.error(err);
                                                callback ? callback(new Error(INSERT_DATABASE_ERROR)) : void(0);
                                                return reject(new Error(INSERT_DATABASE_ERROR));
                                            }
                                        })
                                    } else {
                                        console.error(err);
                                        callback ? callback(new Error(INSERT_DATABASE_ERROR)) : void(0);
                                        return reject(new Error(INSERT_DATABASE_ERROR));
                                    }
                                });
                            }
                        } else {
                            eventCollection.insert(newEvent, (err, result) => {
                                if (!err) {
                                    // Broadcast new Event to any listeners
                                    var cleanEvent = this._cleanEvent(newEvent);
                                    this._sendToListeners(cleanEvent, source);
                                    callback ? callback(undefined, cleanEvent) : void(0);
                                    return resolve(cleanEvent);
                                } else {
                                    console.error(err);
                                    callback ? callback(new Error(INSERT_DATABASE_ERROR)) : void(0);
                                    return reject(new Error(INSERT_DATABASE_ERROR));
                                }
                            });
                        }
                    });
                } else if (ephemeralEvent) {
                    // Don't store anything, just sent it off
                    this._sendToListeners(newEvent, source);
                    callback ? callback(undefined, newEvent) : void(0);
                    return resolve(newEvent);
                } else if (addressableReplaceable) {
                    var thisPubkey = newEvent.pubkey;
                    var dTag = this._getTag(newEvent.tags, "d");

                    if (dTag == undefined || !Array.isArray(dTag) || dTag.length < 1) {
                        // callback(new Error("Invalid DTag"));
                        callback ? callback(new Error(INSERT_EVENT_ERROR)) : void(0);
                        return reject(new Error(INSERT_EVENT_ERROR));
                    }

                    this._findResultsOR(eventCollection, { pubkey: thisPubkey, kind: thisKind }, {}, (err, results) => {
                        if (!err) {
                            if (results != undefined && results.length > 0) {
                                // We are going to find some results with the pubkey and kind.
                                // Weed out the ones without the d tag
                                var FoundEvent = false;

                                for (var i = 0; i < results.length; i++) {
                                    var thisEvent = results[i];
                                    var thisEventDTag = this._getTag(thisEvent.tags, "d");

                                    if (thisEventDTag != undefined && thisEventDTag.length > 1 && (thisEventDTag[1] == dTag[1])) {
                                        // Found!
                                        FoundEvent = true;
                                        if (thisEvent.created_at <= newEvent.created_at) {
                                            eventCollection.remove({ id: thisEvent.id }, (err) => {
                                                if (!err) {
                                                    eventCollection.insert(newEvent, (err) => {
                                                        if (!err) {
                                                            // Broadcast new Event to any listeners
                                                            var cleanEvent = this._cleanEvent(newEvent);
                                                            this._sendToListeners(cleanEvent, source);
                                                            callback ? callback(undefined, cleanEvent) : void(0);
                                                            return resolve(cleanEvent);
                                                        } else {
                                                            console.error(err);
                                                            callback ? callback(new Error(INSERT_DATABASE_ERROR)) : void(0);
                                                            return reject(new Error(INSERT_DATABASE_ERROR));
                                                        }
                                                    });
                                                } else {
                                                    console.error(err);
                                                    callback ? callback(new Error(INSERT_DATABASE_ERROR)) : void(0);
                                                    return reject(new Error(INSERT_DATABASE_ERROR));
                                                }
                                            });
                                            break;
                                        } else {
                                            callback ? callback(undefined, thisEvent) : void(0);
                                            return resolve(thisEvent);
                                        }
                                    }
                                }
                                if (!FoundEvent){
                                    eventCollection.insert(newEvent, (err) => {
                                        if (!err) {
                                            // Broadcast new Event to any listeners
                                            var cleanEvent = this._cleanEvent(newEvent);
                                            this._sendToListeners(cleanEvent, source);
                                            callback ? callback(undefined, cleanEvent) : void(0);
                                            return resolve(cleanEvent);
                                        } else {
                                            console.error(err);
                                            callback ? callback(new Error(INSERT_DATABASE_ERROR)) : void(0);
                                            return reject(new Error(INSERT_DATABASE_ERROR));
                                        }
                                    });
                                }

                            } else {
                                eventCollection.insert(newEvent, (err) => {
                                    if (!err) {
                                        // Broadcast new Event to any listeners
                                        var cleanEvent = this._cleanEvent(newEvent);
                                        this._sendToListeners(cleanEvent, source);
                                        callback ? callback(undefined, cleanEvent) : void(0);
                                        return resolve(cleanEvent);
                                    } else {
                                        console.error(err);
                                        callback ? callback(new Error(INSERT_DATABASE_ERROR)) : void(0);
                                        return reject(new Error(INSERT_DATABASE_ERROR));
                                    }
                                });
                            }
                        } else {
                            console.error(err);
                            callback ? callback(new Error(INSERT_DATABASE_ERROR)) : void(0);
                            return reject(new Error(INSERT_DATABASE_ERROR));
                        }
                    });
                } else {
                    callback ? callback(new Error(INSERT_EVENT_ERROR)) : void(0);
                    return reject(new Error(INSERT_EVENT_ERROR));
                }

                /*
                for kind n such that 1000 <= n < 10000 || 4 <= n < 45 || n == 1 || n == 2, events are regular, which means they're all expected to be stored by relays.
    for kind n such that 10000 <= n < 20000 || n == 0 || n == 3, events are replaceable, which means that, for each combination of pubkey and kind, only the latest event MUST be stored by relays, older versions MAY be discarded.
    for kind n such that 20000 <= n < 30000, events are ephemeral, which means they are not expected to be stored by relays.
    for kind n such that 30000 <= n < 40000, events are addressable by their kind, pubkey and d tag value -- which means that, for each combination of kind, pubkey and the d tag value, only the latest event MUST be stored by relays, older versions MAY be discarded.
                */

            } else {
                callback ? callback(new Error(INSERT_EVENT_ERROR)) : void(0);
                return reject(new Error(INSERT_EVENT_ERROR));
            }
        }); // Promise
        
    }

    _sendToListeners(newEvent, source){
        var contextList = Object.keys(this.querySubs);

        /*
        {
            "SELF":{
                '123': [
                    [query1, listener1],
                    [query2, listener2]
                ],
                '456': [
                    [query3, listener3]
                ]
            },
            SOCKET:{
                '123': [
                    [query4, listener4],
                    [query5, listener5]
                ],
                '456': [
                    [query6, listener6]
                ]
            }
        }
        
        */

        if (contextList && contextList.length > 0){
            for (var i = 0; i < contextList.length; i++){
                // Going through a list of contexts
                var thisContextObject = this.querySubs[contextList[i]];

                if (thisContextObject && typeof thisContextObject === 'object'){
                    var subscriptionLists = Object.keys(thisContextObject);

                    if (subscriptionLists && subscriptionLists.length > 0) {
                        for (var j = 0; j < subscriptionLists.length; j++){
                            var thisSubscriptionObject = thisContextObject[subscriptionLists[j]];

                            if (thisSubscriptionObject && Array.isArray(thisSubscriptionObject)){
                                for(var k = 0; k < thisSubscriptionObject.length; k++){
                                    var thisListener = thisSubscriptionObject[k];

                                    if (thisListener && Array.isArray(thisListener) && thisListener.length == 2){
                                        var queryList = thisListener[0];
                                        var thisCallback = thisListener[1];

                                        for (var m = 0; m < queryList.length; m++){
                                            var thisQuery = queryList[m];
                                            if (this._matchEvent(newEvent, thisQuery)){
                                                thisCallback(contextList[i],subscriptionLists[j], source, newEvent);
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }


        // if (contextList && contextList.length > 0){
        //     for (var i = 0; i < contextList.length; i++){
        //         var thisContext = this.querySubs[contextList[i]];
        //         // var subList = Object.keys(this.querySubs[thisContext]);

        //         for (var j = 0; j < thisContext.length; j++){
        //             var subscription = thisContext[i];
        
        //             if (subscription && Array.isArray(subscription) && subscription.length == 2){
        //                 var query = subscription[0];
        //                 var listener = subscription[1];
        
        //                 if (this._matchEvent(newEvent, query)){
        //                     listener(contextList[i], subList[j], newEvent);
        //                 }
        //             }
        //         }
        //     }
        // }
        // var subList = Object.keys(this.querySubs);

        // for (var j = 0; j < subList.length; j++){
        //     var subscription = this.querySubs[subList[i]];

        //     if (subscription && Array.isArray(subscription) && subscription.length == 2){
        //         var query = subscription[0];
        //         var listener = subscription[1];

        //         if (this._matchEvent(newEvent, query)){
        //             listener(subList[j], newEvent);
        //         }
        //     }
        // }
    }

    clearAllQueries(){
        this.querySubs = {};
    }

    endQuery(context, subID = undefined) {
        if (!subID){ // If SubID is undefined, kill all listeners for a given context
            if (this.querySubs[context]){
                delete this.querySubs[context];
            }
        } else {
            if (this.querySubs[context] && this.querySubs[context][subID]){
                delete this.querySubs[context][subID];
            }
        }
    }

    queryLocal(query, subID, listener, callback){
        // For function calls context
        this.query(query, undefined, subID, listener, (err, context, subID, results) => {
            callback(err, context, subID, results);
        });
    }

    query(inQuery, context, subID, listener, callback){
        var eventCollection = this.EmbeddedDB.collection(this.defaultCollection);
        var queryList = [];

        if (!context){
            context = "SELF";
        }

        if (inQuery != undefined){
            queryList = Array.isArray(inQuery) ? inQuery : [inQuery];

            if (subID == undefined){
                subID = (Math.ceil(Math.random() * 10000)).toString();
            } else if (typeof subID === 'number'){
                subID = subID.toString();
            }

            if (listener != null && typeof listener === 'function') {
                var subContext = this.querySubs[context];

                if (subContext){
                    if (!subContext[subID]){
                        subContext[subID] = [];
                    }

                    subContext[subID].push([queryList,listener]);
                } else {
                    subContext = {};
                    subContext[subID] = [[queryList, listener]];
                }

                this.querySubs[context] = subContext;
            }

            var finalSearchResults = [];
            // var finalDatabaseQuery = {'$or': []};
            var finalDatabaseQuery = [];
            var isValidRequest = true;
            for (var p = 0; p < queryList.length; p++){
                var thisQuery = queryList[p];

                var thisDatabaseQuery = {};
                var isValidQuery = true;
    
                var ids = thisQuery.ids;
                var authors = thisQuery.authors;
                var kinds = thisQuery.kinds;
                var since = thisQuery.since;
                var until = thisQuery.until;
                var limit = thisQuery.limit ? thisQuery.limit : 0;
                var tags = {};
    
                for (var i = 0; i < Object.keys(thisQuery).length; i++){
                    var thisKey = Object.keys(thisQuery)[i];
    
                    if (thisKey.startsWith('#')){
                        tags[thisKey] = thisQuery[thisKey];
                    }
                }
    
                if (Object.keys(tags).length > 0){
                    thisDatabaseQuery['tags'] = { '$exists': true, '$ne' : ''};
                    // databaseQuery['tags'] = { '$exists': true, '$not': {'$size': 0}};
                }
    
                if (ids != undefined){
                    if (Array.isArray(ids)){
                        thisDatabaseQuery['id'] = {'$in':ids};
                    } else {
                        isValidQuery = false;
                    }
                }
    
                if (authors != undefined && isValidQuery){
                    if (Array.isArray(authors)){
                        thisDatabaseQuery['pubkey'] = {'$in':authors};
                    } else {
                        isValidQuery = false;
                    }
                }
    
                if (kinds != undefined && isValidQuery){
                    if (Array.isArray(kinds) && kinds.every((element) => { return typeof element === 'number'})){
                        thisDatabaseQuery['kind'] = {'$in':kinds};
                    } else {
                        isValidQuery = false;
                    }
                }
    
                if (since != undefined && isValidQuery){
                    if (typeof since === 'number' && since >= 0){
                        thisDatabaseQuery['created_at'] = {'$gt': since};
                    } else {
                        isValidQuery = false;
                    }
                }
    
                if (until != undefined && isValidQuery){
                    if (typeof until === 'number' && until >= 0){
                        if (thisDatabaseQuery['created_at'] && thisDatabaseQuery['created_at']['$gt']){
                            thisDatabaseQuery['created_at']['$lt'] = until;
                        } else {
                            thisDatabaseQuery['created_at'] = {'$lt':until};
                        }
                    } else {
                        isValidQuery = false;
                    }
                }

                if (isValidQuery){
                    // finalDatabaseQuery['$or'].push(thisDatabaseQuery);
                    finalDatabaseQuery.push(thisDatabaseQuery);
                } else {
                    isValidRequest = false;
                    break;
                }
            } // Query Loop

    
                // if (tags != undefined && isValidQuery){
                //     for (var i = 0; i < Object.keys(tags); i++){
                //         databaseQuery[Object.keys(tags)[i]] = {'$in':[tags[Object.keys(tags)[i]]]};
                //     }
                // }
    
            if (isValidRequest){
                this._findResultsOR(eventCollection, finalDatabaseQuery, (limit != undefined && typeof limit === 'number' && Object.keys(tags).length == 0) ? {limit:limit} : {}, (err, results) => {
                    var parsedSearchResults = [];
                    
                    if (!err) {
                        // We have to parse through tags here
                        var isMatch;
                        
                        for (var i = 0; i < results.length; i++){
                            isMatch = true;
                            var thisEvent = results[i];

                            if (Object.keys(tags).length > 0) {
                                var thisEventTags = thisEvent.tags;
    
                                if (thisEventTags.length > 0) {
                                    var queryTagsList = Object.keys(tags);

                                    for (var j = 0; j < queryTagsList.length; j++){
                                        // console.log("First: ", this._getTag(thisEventTags, queryTagsList[j].replace('#','')));
                                        // console.log("Second: ", tags[queryTagsList[j]]);

                                        // var tagArray = this._getTag(thisEventTags, queryTagsList[j].replace('#',''));

                                        if (!this._matchTags(thisEvent, queryTagsList[j].replace('#',''), tags[queryTagsList[j]])){
                                            isMatch = false;
                                            break;
                                        }

                                        // if (!(tagArray && tagArray[1] == tags[queryTagsList[j]])){
                                        //     isMatch = false;
                                        //     // break;
                                        // } else {
                                        //     console.log("Match!");
                                        //     // break;
                                        // }
                                    }
                                } else {
                                    continue;
                                }
                            }

                            if (isMatch){
                                parsedSearchResults.push(thisEvent);
                            }
                        }

                        var manualLimit = limit > 0 ? limit : parsedSearchResults.length; // TODO Set limit
                        if (parsedSearchResults.length > 0 && manualLimit <= parsedSearchResults.length){
                            parsedSearchResults = parsedSearchResults.slice(0,manualLimit);
                        }
                        // console.log(parsedSearchResults);
                        callback(undefined, context, subID, parsedSearchResults);
                        // finalSearchResults.concat(parsedSearchResults);
                    } else {
                        console.error(err);
                        callback(new Error(QUERY_DATABASE_ERROR), undefined, subID);
                    }
                });
            } else {
                callback(new Error(QUERY_EVENT_ERROR), undefined, subID);
            }

            // finalSearchResults = this._dedupeEventsList(finalSearchResults);
            // callback(undefined, context, subID, finalSearchResults);
        } else {
            callback(new Error(QUERY_EVENT_ERROR), undefined, subID);
        }
        
        /*
        {
            "ids": <a list of event ids>,
            "authors": <a list of lowercase pubkeys, the pubkey of an event must be one of these>,
            "kinds": <a list of a kind numbers>,
            "#<single-letter (a-zA-Z)>": <a list of tag values, for #e — a list of event ids, for #p — a list of pubkeys, etc.>,
            "since": <an integer unix timestamp in seconds. Events must have a created_at >= to this to pass>,
            "until": <an integer unix timestamp in seconds. Events must have a created_at <= to this to pass>,
            "limit": <maximum number of events relays SHOULD return in the initial query>
        }
        */
    }

    _matchTags(thisEvent, tag, value){
        var isMatch = false;

        if (thisEvent && thisEvent.tags && Array.isArray(thisEvent.tags) && tag){
            var eventTags = thisEvent.tags;

            for (var i = 0; i < eventTags.length; i++){
                var thisTag = eventTags[i];

                if (thisTag && Array.isArray(thisTag) && thisTag.length > 0){
                    var tagLabel = thisTag[0];

                    if (tagLabel == tag){
                        if (thisTag.length == 1 && tagLabel == tag && !value){
                            isMatch = true;
                            break;
                        } else if (thisTag.length > 1){
                            for (var j = 1; j < thisTag.length; j++){
                                var tagValue = thisTag[j];
    
                                if (tagValue == value){
                                    isMatch = true;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        return isMatch;
    }

    _dedupeEventsList(eventList) {
        var eventTable = {};

        for (var i = 0; i < eventList.length; i++){
            var thisEvent = eventList[i];
            
            eventTable[thisEvent.id] = thisEvent;
        }

        return Object.values(eventTable);
    }

    _matchEvent(newEvent, query = {}) {
        var isMatch = true;

        // Todo: Match tags

        var ids = query.ids;
        var authors = query.authors;
        var kinds = query.kinds;
        var since = query.since;
        var until = query.until;
        // var limit = query.limit ? query.limit : 0;
        var tags = {};

        if (newEvent == undefined || !NostrTools.validateEvent(newEvent)){
            isMatch = false;
        }

        if (isMatch){
            for (var i = 0; i < Object.keys(query).length; i++){
                var thisKey = Object.keys(query)[i];
    
                if (thisKey.startsWith('#')){
                    tags[thisKey] = query[thisKey];
                }
            }
        }

        if (ids && isMatch){
            isMatch = false;
            if (Array.isArray(ids) && ids.length > 0){
                for (var i = 0; i < ids.length; i++){
                    var thisId = ids[i];

                    if (thisId == newEvent.id){
                        isMatch = true;
                        break;
                    }
                }
            }
        }

        if (authors && isMatch){
            isMatch = false;

            if (Array.isArray(authors) && authors.length > 0){
                for (var i = 0; i < authors.length; i++){
                    var thisAuthor = authors[i];

                    if (thisAuthor == newEvent.pubkey){
                        isMatch = true;
                        break;
                    }
                }
            }
        }

        if (kinds && isMatch){
            isMatch = false;

            if (Array.isArray(kinds) && kinds.length > 0){
                for (var i = 0; i < kinds.length; i++){
                    var thisKind = kinds[i];

                    if (thisKind == newEvent.kind){
                        isMatch = true;
                        break;
                    }
                }
            }
        }

        if (since && isMatch){
            isMatch = false;

            if (typeof since === 'number' && since >= 0){
                if (newEvent.created_at >= since){
                    isMatch = true;
                }
            }
        }

        if (until && isMatch){
            isMatch = false;

            if (typeof until === 'number' && until >= 0){
                if (newEvent.created_at <= until){
                    isMatch = true;
                }
            }
        }

        // TODO Match Tags
        var queryTagsList = Object.keys(tags);
        if (queryTagsList.length > 0){
            // var tagMatch = true;

            var thisEventTags = newEvent.tags;

            if (thisEventTags.length > 0){
                for (var i = 0; i < queryTagsList.length; i++){
                    // var tagArray = this._getTag(thisEventTags, queryTagsList[i].replace('#',''))

                    // if (!(tagArray && tagArray[1] == tags[queryTagsList[i]])){
                    //     isMatch = false;
                    // }

                    if (!this._matchTags(newEvent,queryTagsList[i].replace('#',''),tags[queryTagsList[i]])){
                        isMatch = false;
                    }
                }
            } else {
                isMatch = false;
            }
        }

        // var isMatch;
                        
        // for (var i = 0; i < results.length; i++){
        //     isMatch = true;
        //     var thisEvent = results[i];

        //     if (Object.keys(tags).length > 0) {
        //         var thisEventTags = thisEvent.tags;

        //         if (thisEventTags.length > 0) {
        //             var queryTagsList = Object.keys(tags);
        //             for (var j = 0; j < queryTagsList.length; j++){
        //                 // console.log("First: ", this._getTag(thisEventTags, queryTagsList[j].replace('#','')));
        //                 // console.log("Second: ", tags[queryTagsList[j]]);

        //                 var tagArray = this._getTag(thisEventTags, queryTagsList[j].replace('#',''));

        //                 if (!(tagArray && tagArray[1] == tags[queryTagsList[j]])){
        //                     isMatch = false;
        //                     break;
        //                 }
        //             }
        //         } else {
        //             continue;
        //         }
        //     }

        //     if (isMatch){
        //         finalSearchResults.push(thisEvent);
        //     }
        // }

        return isMatch;
    }

    // _findResults(collection, criteria, options, callback){
    //     collection.find(criteria, {_id:0}, options, (err, results) => {
    //         if (!err){
    //             results.toArray((err, rArray) => {
    //                 if (!err){
    //                     callback(undefined, rArray);
    //                 } else {
    //                     callback(err);
    //                 }
    //             });
    //         } else {
    //             callback(err);
    //         }
    //     });
    // }

    _findResultsOR(collection, criteria, options, callback){
        var criteriaArray = Array.isArray(criteria) ? criteria : [criteria];
        var finalResults = [];

        options = options ? options : {};

        // options["sort"] = {id: -1};
        options["sort"] = {created_at: -1};

        var count = 0;
        for (var i = 0; i < criteriaArray.length; i++){
            var thisCriteria = criteriaArray[i];

            collection.find(thisCriteria, {_id:0}, options, (err, results) => {
                if (!err){
                    results.toArray((err, rArray) => {
                        if (!err){
                            // callback(undefined, rArray);
                            // console.log("rArray: ", rArray);
                            finalResults = finalResults.concat(rArray);
                            count++;

                            if (count == criteriaArray.length){
                                // console.log("Dedupe: ", this._dedupeEventsList(finalResults));
                                callback(undefined, this._dedupeEventsList(finalResults));
                            }
                        } else {
                            callback(err);
                        }
                    });
                } else {
                    callback(err);
                }
            });

            // if (i == (criteria.length - 1)){
            //     console.log("Done");

            //     callback(undefined, this._dedupeEventsList(finalResults));
            // }
        }
    }

    _cleanEvent(newEvent){
        var cleanEvent = {};

        if (newEvent){
            cleanEvent.id = newEvent.id;
            cleanEvent.pubkey = newEvent.pubkey;
            cleanEvent.content = newEvent.content;
            cleanEvent.kind = newEvent.kind;
            cleanEvent.created_at = newEvent.created_at;
            cleanEvent.tags = newEvent.tags;
            cleanEvent.sig = newEvent.sig;
        }

        return cleanEvent;
    }

    _verifyEvent(thisEvent){
        return NostrTools.verifyEvent(thisEvent);
    }

    _getTag(tagArray, tagLabel){
        var tagItem;

        if (tagArray != undefined && tagLabel != undefined && Array.isArray(tagArray)){
            for (var i = 0; i < tagArray.length; i++){
                var thisTag = tagArray[i];

                if (thisTag != undefined && Array.isArray(thisTag) && thisTag.length > 1){
                    var thisTagLabel = thisTag[0];

                    if (thisTagLabel == tagLabel){
                        tagItem = thisTag;
                        break;
                    }
                }
            }
        }

        return tagItem;
    }
}

module.exports = Relay;
module.exports.INSERT_DATABASE_ERROR = INSERT_DATABASE_ERROR;
module.exports.INSERT_EVENT_ERROR = INSERT_EVENT_ERROR;
module.exports.QUERY_DATABASE_ERROR = QUERY_DATABASE_ERROR;
module.exports.QUERY_EVENT_ERROR = QUERY_EVENT_ERROR;
/**
 * 
const INSERT_DATABASE_ERROR = "insert: database error";
const INSERT_EVENT_ERROR = "insert: invalid event error";
const QUERY_DATABASE_ERROR = "query: invalid event error";
const QUERY_EVENT_ERROR = "query: invalid event error";
 */