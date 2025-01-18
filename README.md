# pocket
Pocket is a lightweight nostr relay that can be used as a local relay, in a peer-to-peer manner with other relays, and as an embedded relay in applications.

## Usage

`node index.js [options]`

**Relay Options**

  --hostname *hostname*   Bind relay hostname. Default is 127.0.0.1               
  --port *port*           Set relay listening port. Default is 80                 
  --dbpath *directory*    Set location for local relay database. Default is       
                        ./database                                              
  --persistentdb        Retain relay database. If not set database will be      
                        wiped upon start                                        

**P2P Options**

  --p2p                     Run in P2P mode. Uses Hyperswarm DHT to connect to  
                            peers.                                              
  --p2pkey *string hex key*   Set Hyperswarm "Topic" Key. If none is specified a  
                            random one will be set.                             
  --p2pcache *directory*      Location for Hypercore P2P databases. Default       
                            location is ./database/hcbase                       

**Misc**

  -h, --help       Print this usage guide. 
  -v, --verbose    Verbose output          

  ## Quick Start Guide

  **NOTE: This is early and most likely broken code right now. All documentation subject to frequent changes**

  TBD
