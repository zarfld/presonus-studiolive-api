// PreSonus API Bridge Process
// This runs as a separate Node.js process with the real PreSonus API
// Communicates with C# wrapper via stdio JSON-RPC

const { Client, Discovery } = require('./dist/cjs/api.js');
const { getZlibValue } = require('./dist/cjs/lib/util/zlib/zlibUtil.js');
const domain = require('domain');
const fs = require('fs');
const path = require('path');

// Import ZlibValueSymbol to extract values from ZlibNode objects
const { ZlibValueSymbol } = require('./dist/cjs/lib/util/zlib/zlibNodeParser.js');

// Single debug log file
const DEBUG_LOG = path.join(process.cwd(), 'debug-output.log');

// Initialize log file
try {
    fs.writeFileSync(DEBUG_LOG, `=== Bridge Debug Log Started: ${new Date().toISOString()} ===\n`);
} catch (err) {
    console.error(`Failed to initialize log file: ${err.message}`);
}

// Debug logging function - writes to file instead of console.error
function debugLog(...args) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    try {
        fs.appendFileSync(DEBUG_LOG, `[${timestamp}] ${message}\n`);
    } catch (err) {
        // Fallback to console if file write fails
        console.error(`[${timestamp}] ${message}`);
    }
}

// Helper to extract value from ZlibNode (which stores values in Symbol properties)
function extractZlibNodeValue(node) {
    if (!node || typeof node !== 'object') return node;
    
    // Check if this is a ZlibNode with a Symbol value
    const symbols = Object.getOwnPropertySymbols(node);
    const valueSymbol = symbols.find(s => s.toString() === 'Symbol(value)');
    
    if (valueSymbol && node[valueSymbol] !== undefined) {
        return node[valueSymbol];
    }
    
    return node;
}

// Map channel type and number to actual ZLIB structure
// PreSonus ZLIB structure (as discovered from actual mixer data):
// - Line channels: ch4-ch32 at root level (ch1-ch3 got redirected to fxreturn during parse)
// - Other types: aux.ch1, return.ch1, etc.
function mapChannelPath(channelType, channelNumber, property) {
    // Direct property access - no mapping
    // C# API has separate functions for 'name' vs 'username'
    const zlibProperty = property;
    
    if (channelType === 'line') {
        // Line channels: ch1-ch9 are in line.ch1 container, ch10-32 at root level
        // Try both locations
        return { 
            path: `ch${channelNumber}/${zlibProperty}`, 
            channelKey: `ch${channelNumber}`,
            fallbackPath: `line/ch${channelNumber}/${zlibProperty}`
        };
    }
    
    // Other types use nested structure: aux.ch1, return.ch1, etc.
    return { path: `${channelType}/ch${channelNumber}/${zlibProperty}`, channelKey: `ch${channelNumber}` };
}

class PreSonusApiBridge {
    constructor() {
        this.clients = new Map(); // clientId -> Client instance
        this.discoveries = new Map(); // discoveryId -> Discovery instance
        this.requestId = 0;
        
        // Set up stdio communication
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (data) => {
            try {
                const lines = data.trim().split('\n');
                for (const line of lines) {
                    if (line.trim()) {
                        this.handleRequest(JSON.parse(line));
                    }
                }
            } catch (error) {
                this.sendError(null, `Parse error: ${error.message}`);
            }
        });
        
        this.sendResponse(null, { 
            type: 'ready', 
            message: 'PreSonus API Bridge ready',
            pid: process.pid
        });
    }
    
    handleRequest(request) {
        const { id, method, params = {} } = request;
        
        try {
            switch (method) {
                case 'discovery.start':
                    this.startDiscovery(id, params);
                    break;
                    
                case 'discovery.stop':
                    this.stopDiscovery(id, params);
                    break;
                    
                case 'client.create':
                    this.createClient(id, params);
                    break;
                    
                case 'client.connect':
                    this.connectClient(id, params);
                    break;
                    
                case 'client.close':
                    this.closeClient(id, params);
                    break;
                    
                case 'client.setMute':
                    this.setMute(id, params);
                    break;
                    
                case 'client.getMute':
                    this.getMute(id, params);
                    break;
                    
                case 'client.setChannelVolume':
                    this.setChannelVolume(id, params);
                    break;
                    
                case 'mixer.setChannelProperty':
                    this.setChannelProperty(id, params);
                    break;
                    
                case 'mixer.getChannelProperty':
                    this.getChannelProperty(id, params);
                    break;
                    
                case 'mixer.setChannelPan':
                    this.setChannelPan(id, params);
                    break;
                    
                case 'mixer.getChannelPan':
                    this.getChannelPan(id, params);
                    break;
                    
                // Complete object model methods
                case 'getMixerState':
                    this.getMixerState(id, params);
                    break;
                    
                case 'setMixerProperty':
                    this.setMixerProperty(id, params);
                    break;
                    
                case 'getMixerProperty':
                    this.getMixerProperty(id, params);
                    break;
                    
                case 'loadScene':
                    this.loadScene(id, params);
                    break;
                    
                case 'saveScene':
                    this.saveScene(id, params);
                    break;
                    
                case 'getSceneList':
                    this.getSceneList(id, params);
                    break;
                    
                case 'getChannelCount':
                    this.getChannelCount(id, params);
                    break;
                    
                default:
                    this.sendError(id, `Unknown method: ${method}`);
            }
        } catch (error) {
            this.sendError(id, `Method error: ${error.message}`);
        }
    }
    
    async startDiscovery(requestId, { discoveryId, timeout = 10000 }) {
        try {
            // Use static Client.discover method that we know works
            const devices = await Client.discover(timeout);
            const deviceArray = Object.values(devices);
            
            this.sendResponse(requestId, {
                type: 'discovery.devices',
                discoveryId,
                devices: deviceArray.map(d => ({
                    name: d.name,
                    ip: d.ip,
                    port: d.port,
                    serial: d.serial
                }))
            });
        } catch (error) {
            this.sendError(requestId, `Discovery failed: ${error.message}`);
        }
    }
    
    stopDiscovery(requestId, { discoveryId }) {
        // Discovery automatically stops after timeout
        this.sendResponse(requestId, { 
            type: 'discovery.stopped', 
            discoveryId 
        });
    }
    
    createClient(requestId, { clientId, host, port, options = {} }) {
        try {
            // Create a domain to isolate client operations and catch all errors
            const clientDomain = domain.create();
            const bridge = this;
            
            clientDomain.on('error', (error) => {
                console.error(`Client ${clientId} domain error:`, error.message);
                console.error('Stack:', error.stack);
                
                // Send error event but don't crash the bridge
                bridge.sendEvent('client.processing.error', { 
                    clientId, 
                    error: error.message,
                    stack: error.stack
                });
                
                // Clean up client if error is fatal
                if (bridge.clients.has(clientId)) {
                    const client = bridge.clients.get(clientId);
                    try {
                        client.close();
                    } catch (closeError) {
                        console.error(`Error closing client ${clientId}:`, closeError.message);
                    }
                    bridge.clients.delete(clientId);
                    bridge.sendEvent('client.closed', { clientId, reason: 'error' });
                }
            });
            
            // Run client creation within the domain
            clientDomain.run(() => {
                console.error(`[DEBUG createClient] Creating client for ${host}:${port}`);
                
                const client = new Client({ host, port }, {
                    autoreconnect: false,
                    logLevel: 'info', // Change to 'info' to see connection details
                    ...options
                });
                
                console.error(`[DEBUG createClient] Client instance created`);
                
                // Add debug listener specifically for ZB (ZLIB) event to inspect structure
                client.on('ZB', (zlibData) => {
                    console.error(`[DEBUG ZB Event] Received ZLIB data`);
                    console.error(`[DEBUG ZB Event] zlibData type:`, typeof zlibData);
                    console.error(`[DEBUG ZB Event] zlibData is null?`, zlibData === null);
                    console.error(`[DEBUG ZB Event] zlibData is undefined?`, zlibData === undefined);
                    
                    // SAVE ACTUAL ZLIB JSON TO FILE
                    if (zlibData && typeof zlibData === 'object') {
                        try {
                            const fs = require('fs');
                            const path = require('path');
                            const outputPath = path.join(process.cwd(), 'zlib-structure.json');
                            
                            // Use custom replacer to handle Symbol values and circular references
                            const seen = new WeakSet();
                            const replacer = (key, value) => {
                                if (value && typeof value === 'object') {
                                    if (seen.has(value)) {
                                        return '[Circular]';
                                    }
                                    seen.add(value);
                                    
                                    // Check if it has Symbol properties (ZlibNode)
                                    const symbols = Object.getOwnPropertySymbols(value);
                                    if (symbols.length > 0) {
                                        const symbolValues = {};
                                        symbols.forEach(sym => {
                                            symbolValues[sym.toString()] = value[sym];
                                        });
                                        return { ...value, __symbolValue: symbolValues[symbols[0].toString()] };
                                    }
                                }
                                return value;
                            };
                            
                            fs.writeFileSync(outputPath, JSON.stringify(zlibData, replacer, 2));
                            console.error(`[DEBUG] ✅ ZLIB structure saved to: ${outputPath}`);
                        } catch (err) {
                            console.error(`[DEBUG] ❌ Failed to save ZLIB structure: ${err.message}`);
                        }
                        
                        // Log structure as-is, NO reorganization
                        const keys = Object.keys(zlibData);
                        console.error(`[DEBUG ZB Event] Top-level keys (first 20):`, keys.slice(0, 20).join(', '));
                        console.error(`[DEBUG ZB Event] Total keys:`, keys.length);
                        
                        // Check for expected mixer sections
                        const expectedSections = ['line', 'aux', 'main', 'fx', 'sub', 'dca'];
                        const foundSections = expectedSections.filter(s => zlibData[s] !== undefined);
                        console.error(`[DEBUG ZB Event] Found mixer sections:`, foundSections.join(', '));
                        
                        if (foundSections.length === 0) {
                            console.error(`[DEBUG ZB Event] ⚠️  WARNING: No expected mixer sections found!`);
                            console.error(`[DEBUG ZB Event] This might be a channel object instead of root`);
                        }
                        
                        // If we have 'line', check its structure
                        if (zlibData.line) {
                            const lineKeys = Object.keys(zlibData.line).slice(0, 10);
                            console.error(`[DEBUG ZB Event] line has keys:`, lineKeys.join(', '));
                        }
                    }
                });
                
                // Add debug listeners for other events
                const events = ['connect', 'connected', 'disconnected', 'closed', 'error'];
                events.forEach(event => {
                    client.on(event, (...args) => {
                        console.error(`[DEBUG Client Event] ${event}:`, args.length > 0 ? (typeof args[0] === 'object' ? JSON.stringify(args[0]).substring(0, 100) : args[0]) : '(no args)');
                    });
                });
                
                // Set up event forwarding
                client.on('connected', () => {
                    this.sendEvent('client.connected', { clientId });
                });
                
                client.on('closed', () => {
                    this.sendEvent('client.closed', { clientId });
                    this.clients.delete(clientId);
                });
                
                client.on('error', (error) => {
                    this.sendEvent('client.error', { 
                        clientId, 
                        error: error.message 
                    });
                });
                
                // Store both client and domain
                client._domain = clientDomain;
                this.clients.set(clientId, client);
                
                console.error(`[DEBUG createClient] Client stored, ready to connect`);
                
                this.sendResponse(requestId, { 
                    type: 'client.created', 
                    clientId 
                });
            });
        } catch (error) {
            console.error(`[DEBUG createClient] Exception:`, error.message, error.stack);
            this.sendError(requestId, `Client creation failed: ${error.message}`);
        }
    }
    
    async connectClient(requestId, { clientId, subscriptionOptions = {} }) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                throw new Error(`Client ${clientId} not found`);
            }
            
            console.error(`[DEBUG] Connecting client ${clientId}...`);
            console.error(`[DEBUG] Client has domain:`, !!client._domain);
            
            // Connect - just call it directly, the client handles its own domain
            await client.connect({
                clientDescription: 'PreSonus C# Wrapper Bridge',
                ...subscriptionOptions
            });
            
            console.error(`[DEBUG] Client connected successfully!`);
            
            // Give a moment for ZLIB to arrive
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.error(`[DEBUG] After 2s wait - client.zlibData has:`, 
                client.zlibData ? Object.keys(client.zlibData).slice(0, 20).join(', ') : 'nothing');
            
            this.sendResponse(requestId, { 
                type: 'client.connected', 
                clientId 
            });
        } catch (error) {
            console.error(`[DEBUG] Connect error:`, error.message);
            console.error(`[DEBUG] Error stack:`, error.stack);
            this.sendError(requestId, `Client connect failed: ${error.message}`);
        }
    }
    
    async closeClient(requestId, { clientId }) {
        try {
            const client = this.clients.get(clientId);
            if (client) {
                await client.close();
                this.clients.delete(clientId);
            }
            
            this.sendResponse(requestId, { 
                type: 'client.closed', 
                clientId 
            });
        } catch (error) {
            this.sendError(requestId, `Client close failed: ${error.message}`);
        }
    }
    
    setMute(requestId, { clientId, selector, muted }) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                throw new Error(`Client ${clientId} not found`);
            }
            
            // Run within client's domain if available
            if (client._domain) {
                client._domain.run(() => {
                    client.setMute(selector, muted);
                });
            } else {
                client.setMute(selector, muted);
            }
            
            this.sendResponse(requestId, { 
                type: 'client.mute.set', 
                clientId, 
                selector, 
                muted 
            });
        } catch (error) {
            this.sendError(requestId, `Set mute failed: ${error.message}`);
        }
    }
    
    getMute(requestId, { clientId, selector }) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                throw new Error(`Client ${clientId} not found`);
            }
            
            let muted;
            
            // Run within client's domain if available
            if (client._domain) {
                client._domain.run(() => {
                    muted = client.getMute(selector);
                });
            } else {
                muted = client.getMute(selector);
            }
            
            this.sendResponse(requestId, { 
                type: 'client.mute.status', 
                clientId, 
                selector, 
                muted 
            });
        } catch (error) {
            this.sendError(requestId, `Get mute failed: ${error.message}`);
        }
    }
    
    getChannelCount(requestId, { clientId, channelType }) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                throw new Error(`Client ${clientId} not found`);
            }
            
            // Map channel type names to channelCounts keys
            const typeMap = {
                'line': 'LINE',
                'aux': 'AUX',
                'fx': 'FX',
                'fxbus': 'FX',
                'fxreturn': 'FXRETURN',
                'return': 'RETURN',
                'talkback': 'TALKBACK',
                'main': 'MAIN',
                'dca': 'DCA',
                'sub': 'SUB',
                'master': 'MASTER',
                'mono': 'MONO'
            };
            
            const countKey = typeMap[channelType.toLowerCase()];
            if (!countKey) {
                throw new Error(`Unknown channel type: ${channelType}`);
            }
            
            const count = client.channelCounts ? client.channelCounts[countKey] : 0;
            
            this.sendResponse(requestId, {
                type: 'channelCount',
                clientId,
                channelType,
                count: count || 0
            });
        } catch (error) {
            this.sendError(requestId, `Get channel count failed: ${error.message}`);
        }
    }
    
    async setChannelVolume(requestId, { clientId, selector, level, duration }) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                throw new Error(`Client ${clientId} not found`);
            }
            
            await client.setChannelVolumeLinear(selector, level, duration);
            
            this.sendResponse(requestId, { 
                type: 'client.volume.set', 
                clientId, 
                selector, 
                level 
            });
        } catch (error) {
            this.sendError(requestId, `Set volume failed: ${error.message}`);
        }
    }
    
    // Enhanced mixer control methods using real UBJSON parsing infrastructure
    
    async setChannelProperty(requestId, { clientId, channelType, channelNumber, property, value }) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                throw new Error(`Client ${clientId} not found`);
            }
            
            // Create property path based on mixer state structure
            // e.g., "line/ch1/mute", "line/ch2/volume", "aux/ch3/pan"
            const propertyPath = `${channelType}/ch${channelNumber}/${property}`;
            console.log(`🎛️  Setting ${propertyPath} = ${value}`);
            
            // Use the client's state cache to set the property
            if (client._domain) {
                client._domain.run(() => {
                    client.state.set(propertyPath, value);
                });
            } else {
                client.state.set(propertyPath, value);
            }
            
            this.sendResponse(requestId, { 
                type: 'mixer.property.set', 
                clientId, 
                channelType,
                channelNumber,
                property,
                value,
                path: propertyPath
            });
            
        } catch (error) {
            this.sendError(requestId, `Set channel property failed: ${error.message}`);
        }
    }
    
    async getChannelProperty(requestId, { clientId, channelType, channelNumber, property }) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                throw new Error(`Client ${clientId} not found`);
            }
            
            // Map channel path correctly for 32SC mixer structure
            const { path: zlibPath, channelKey, parentPath } = mapChannelPath(channelType, channelNumber, property);
            
            let value = null;
            
            // For line channels, try direct ZLIB access
            if (client.zlibData && channelType === 'line') {
                try {
                    // Debug: Check what's actually in zlibData for ch1-9
                    if (channelNumber >= 1 && channelNumber <= 9) {
                        console.error(`[DEBUG] zlibData keys: ${Object.keys(client.zlibData).slice(0, 20).join(', ')}`);
                        if (client.zlibData.line) {
                            console.error(`[DEBUG] zlibData.line type: ${typeof client.zlibData.line}`);
                            console.error(`[DEBUG] zlibData.line keys: ${Object.keys(client.zlibData.line).slice(0, 20).join(', ')}`);
                            if (client.zlibData.line.children) {
                                console.error(`[DEBUG] zlibData.line.children keys: ${Object.keys(client.zlibData.line.children).slice(0, 20).join(', ')}`);
                            }
                        }
                    }
                    
                    // Ch10-32 are at root: client.zlibData.ch10, .ch11, etc.
                    // Ch1-9 are nested: client.zlibData.line.ch1, .ch2, etc.
                    let channelContainer = client.zlibData[channelKey];
                    
                    // If not found at root, try line container for ch1-9
                    if (!channelContainer && channelNumber >= 1 && channelNumber <= 9) {
                        const lineContainer = client.zlibData.line;
                        if (lineContainer && lineContainer.children) {
                            channelContainer = lineContainer.children[channelKey];
                            console.error(`[DEBUG] Trying line container for ${channelKey}`);
                        } else if (lineContainer) {
                            // Maybe line IS the container and ch1 is directly on it
                            channelContainer = lineContainer[channelKey];
                            console.error(`[DEBUG] Trying direct line.${channelKey}`);
                        }
                    }
                    
                    if (channelContainer) {
                        // Real channel data is in .children section
                        const channel = channelContainer.children || channelContainer;
                        
                        // Direct property access - no mapping
                        const zlibProperty = property;
                        
                        // Get property (it's a ZlibNode object)
                        const propertyNode = channel[zlibProperty];
                        if (propertyNode !== undefined) {
                            // Extract value from ZlibNode Symbol
                            value = extractZlibNodeValue(propertyNode);
                            console.error(`[DEBUG] Got ${channelKey}.${zlibProperty} = ${JSON.stringify(value)}`);
                        } else {
                            console.error(`[DEBUG] ${channelKey} exists but ${zlibProperty} property not found`);
                        }
                    } else {
                        console.error(`[DEBUG] ${channelKey} not found in ZLIB - will try state.get() fallback`);
                    }
                } catch (err) {
                    console.error(`[DEBUG] Error accessing ZLIB: ${err.message}`);
                }
            }
            
            // Fallback: Try state cache (populated by ParamValue updates)
            // Changed: Allow state.get() fallback for ALL channels, not just 1-9
            if (value === null && channelNumber >= 1) {
                console.error(`[DEBUG] Channel ${channelNumber} not in ZLIB, trying state.get() fallback...`);
                
                // Direct property access - no mapping needed
                const stateProperty = property;
                
                // For all channels, try direct state query
                const statePath = `${channelType}/ch${channelNumber}/${stateProperty}`;
                console.error(`[DEBUG] State path: ${statePath}`);
                
                if (client._domain) {
                    client._domain.run(() => {
                        value = client.state.get(statePath);
                    });
                } else {
                    value = client.state.get(statePath);
                }
                
                console.error(`[DEBUG] State.get() returned: ${JSON.stringify(value)}`);
            }
            
            // Debug: Log the actual response being sent
            const response = { 
                type: 'mixer.property.get', 
                clientId, 
                channelType,
                channelNumber,
                property,
                value,
                path: zlibPath
            };
            console.error(`[DEBUG Response] Sending: ${JSON.stringify(response)}`);
            this.sendResponse(requestId, response);
            
        } catch (error) {
            console.error(`[ERROR getChannelProperty]`, error);
            this.sendError(requestId, `Get channel property failed: ${error.message}`);
        }
    }
    
    async setChannelPan(requestId, { clientId, channelNumber, panPosition }) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                throw new Error(`Client ${clientId} not found`);
            }
            
            // Use specific pan setting method based on scene file structure
            const selector = { type: 'LINE', channel: channelNumber };
            
            if (client._domain) {
                client._domain.run(() => {
                    client.setChannelPan(selector, panPosition);
                });
            } else {
                client.setChannelPan(selector, panPosition);
            }
            
            this.sendResponse(requestId, { 
                type: 'mixer.pan.set', 
                clientId, 
                channelNumber,
                panPosition 
            });
            
        } catch (error) {
            this.sendError(requestId, `Set channel pan failed: ${error.message}`);
        }
    }
    
    async getChannelPan(requestId, { clientId, channelNumber }) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                throw new Error(`Client ${clientId} not found`);
            }
            
            const selector = { type: 'LINE', channel: channelNumber };
            let panPosition;
            
            if (client._domain) {
                client._domain.run(() => {
                    panPosition = client.getChannelPan(selector);
                });
            } else {
                panPosition = client.getChannelPan(selector);
            }
            
            this.sendResponse(requestId, { 
                type: 'mixer.pan.get', 
                clientId, 
                channelNumber,
                panPosition 
            });
            
        } catch (error) {
            this.sendError(requestId, `Get channel pan failed: ${error.message}`);
        }
    }
    
    sendResponse(requestId, result) {
        const response = { 
            id: requestId, 
            result,
            timestamp: Date.now()
        };
        console.log(JSON.stringify(response));
    }
    
    sendError(requestId, error) {
        const response = { 
            id: requestId, 
            error,
            timestamp: Date.now()
        };
        console.log(JSON.stringify(response));
    }
    
    sendEvent(event, data) {
        const message = { 
            type: 'event', 
            event, 
            data,
            timestamp: Date.now()
        };
        console.log(JSON.stringify(message));
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.error('Bridge shutting down...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.error('Bridge shutting down...');
    process.exit(0);
});

// Start the bridge
const bridge = new PreSonusApiBridge();

// Handle uncaught exceptions to prevent bridge crashes
process.on('uncaughtException', (error, origin) => {
    console.error('Uncaught Exception in PreSonus API Bridge:', error.message);
    console.error('Origin:', origin);
    console.error('Stack:', error.stack);
    
    // Send error event if bridge is available, but don't crash
    try {
        if (bridge) {
            bridge.sendEvent('bridge.error', {
                type: 'uncaught_exception',
                message: error.message,
                stack: error.stack,
                origin: origin
            });
        }
    } catch (eventError) {
        console.error('Failed to send error event:', eventError.message);
    }
    
    // CRITICAL: Prevent process exit by not calling process.exit()
    // Note: This keeps the process running despite the exception
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection in PreSonus API Bridge:', reason);
    
    // Send error event if bridge is available, but don't crash
    try {
        if (bridge) {
            bridge.sendEvent('bridge.error', {
                type: 'unhandled_rejection',
                message: reason?.message || String(reason),
                stack: reason?.stack
            });
        }
    } catch (eventError) {
        console.error('Failed to send error event:', eventError.message);
    }
    
    // Continue running - don't exit the process
});

// Handle warning events to catch any other issues
process.on('warning', (warning) => {
    console.warn('Process Warning:', warning.name, warning.message);
    if (bridge) {
        try {
            bridge.sendEvent('bridge.warning', {
                type: 'process_warning',
                name: warning.name,
                message: warning.message,
                stack: warning.stack
            });
        } catch (eventError) {
            console.error('Failed to send warning event:', eventError.message);
        }
    }
});