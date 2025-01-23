# pocket
Pocket is a lightweight nostr relay that can be used as a local relay, in a peer-to-peer manner with other relays, and as an embedded relay in applications.
## Usage
```
node index.js [options]

Relay Options

  --hostname *hostname*   Bind relay hostname. Default is 127.0.0.1               
  --port *port*           Set relay listening port. Default is 80                 
  --dbpath *directory*    Set location for local relay database. Default is       
                        ./database                                              
  --persistentdb        Retain relay database. If not set database will be      
                        wiped upon start

P2P Options

  --p2p                     Run in P2P mode. Uses Hyperswarm DHT to connect to  
                            peers.                                              
  --p2pkey *string hex key*   Set Hyperswarm "Topic" Key. If none is specified a  
                            random one will be set.                             
  --p2pcache *directory*      Location for Hypercore P2P databases. Default       
                            location is ./database/hcbase                       

Misc

  -h, --help       Print this usage guide. 
  -v, --verbose    Verbose output          

```
  ## Quick Start Guide

  **NOTE: This is early and most likely broken code right now. All documentation subject to frequent changes**

  Right now you can grab the latest code using git clone or the latest pre-release.

  Pull in the modules uing
  `npm install`

  Once installed you can start an empty relay using:
  `node index.js`


  ## P2P Kick start

  To start a new P2P swarm, use a 256-bit key as shown below:

  `node index.js --hostname 127.0.0.1 --port 8080 --p2p --p2pkey aa9ac886032c638cf96b862cf4f7f9e7d945c92f966fe0d001e548610ba5f716`

  Please note that p2p mode should not be used with `--persistentdb` as the events will be stored in the p2p cache and loaded into the relay database during runtime.
  
  ## Active development swarm

  Currently using the topic **a931d76b9f86c9a5c6be7c9e485eb0c90d42bc545c87d63e5cdda1452f64f957** for testing P2P swarm. This could pull in a lot of relay events.

  To run Pocket with in this swarm use:

  `node index.js --hostname 127.0.0.1 --port 8080 --p2p --p2pkey a931d76b9f86c9a5c6be7c9e485eb0c90d42bc545c87d63e5cdda1452f64f957`

  
  


