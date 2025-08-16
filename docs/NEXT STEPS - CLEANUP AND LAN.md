# Next Steps: Cleanup and LAN Research

## 🧹 Repository Cleanup TODOs

### High Priority
- [ ] **Remove orphaned containers/images** - Clean up unused Docker artifacts from experiments
- [ ] **Consolidate documentation** - Merge/organize overlapping PLAN C documents  
- [ ] **Remove redundant files** - Clean up duplicate configs and test files
- [ ] **Update README.md** - Make it the single source of truth for setup

### Medium Priority  
- [ ] **Review .gitignore** - Ensure proper exclusions (logs, temp files, etc.)
- [ ] **Clean up docker-compose files** - Remove unused environment variables
- [ ] **Organize client assets** - Verify which files are actually needed
- [ ] **Document dependencies** - List all required packages/tools clearly

### Low Priority
- [ ] **Add linting/formatting** - Consistent code style across files
- [ ] **Create automated tests** - Verify setup works end-to-end
- [ ] **Performance optimization** - Review resource usage and limits
- [ ] **Security review** - Check for hardcoded secrets, open ports, etc.

---

## 🌐 LAN Deployment Research

### Current State Analysis
**Current Setup:** Everything runs on `127.0.0.1` (localhost only)
- CS Server: `127.0.0.1:27015`
- Web Server: `127.0.0.1:8080` 
- All services use `network_mode: "host"`

### LAN Requirements to Research

#### 1. Network Architecture Design
- [ ] **Multi-host networking** - How to expose services across LAN
- [ ] **Service discovery** - How clients find the game server
- [ ] **Load balancing** - Multiple game servers support
- [ ] **Firewall considerations** - Required port openings

#### 2. WebRTC LAN Challenges  
- [ ] **STUN/TURN servers** - Do we need them for LAN?
- [ ] **ICE candidate filtering** - Prefer local network candidates
- [ ] **NAT traversal** - Probably not needed for LAN but verify
- [ ] **mDNS/Bonjour** - Auto-discovery on local network

#### 3. Configuration Changes Needed
- [ ] **Dynamic IP discovery** - Replace hardcoded `127.0.0.1`
- [ ] **Environment variables** - Configurable host/port settings
- [ ] **Docker networking** - Bridge vs host mode for LAN
- [ ] **Reverse proxy** - Nginx/Caddy for proper routing

#### 4. Client Modifications
- [ ] **Server list API** - Dynamic server discovery
- [ ] **Connection UI** - Server browser interface  
- [ ] **Auto-connect logic** - Smart server selection
- [ ] **Error handling** - Better network failure messages

#### 5. Deployment Models to Consider

##### Option A: Single Host (Current + LAN exposure)
```
[Host Machine]
├── CS Server (exposed to LAN)
├── WebRTC Server (exposed to LAN) 
└── All clients connect to this host
```

##### Option B: Distributed (Multiple hosts)
```
[Game Host] ── CS Server
[Web Host]  ── WebRTC Server + Client files
[Client N]  ── Browser connections
```

##### Option C: Docker Swarm/Kubernetes
```
[Orchestrated Cluster]
├── Load Balancer
├── Game Server Pods
├── WebRTC Server Pods
└── Shared Storage
```

### Research Questions

#### Technical Questions
- [ ] How does WebRTC behave in LAN-only environments?
- [ ] Do we need a TURN server for LAN, or is STUN sufficient?
- [ ] What's the best way to handle dynamic IP assignment?
- [ ] How do we handle multiple concurrent games?

#### Configuration Questions  
- [ ] What Docker networking mode works best for LAN?
- [ ] How to make environment variables dynamic?
- [ ] Should we use DNS names vs IP addresses?
- [ ] How to handle different subnet configurations?

#### User Experience Questions
- [ ] How should players discover available servers?
- [ ] What happens when a game server goes down?
- [ ] How to handle player reconnection?
- [ ] Should we support persistent player profiles?

### Validation Plan
1. **Local testing** - Test with VMs on same host
2. **LAN testing** - Test across multiple physical machines  
3. **Performance testing** - Measure latency/throughput
4. **Failure testing** - Network interruptions, server crashes
5. **User testing** - Real gameplay scenarios

---

## 🔍 Investigation Methodology

### Phase 1: Research (No Changes)
- Study WebRTC LAN behavior
- Review Docker networking options
- Research similar projects/solutions
- Document findings and trade-offs

### Phase 2: Design
- Create network architecture diagrams
- Define configuration variables needed
- Plan migration strategy from localhost
- Design testing approach

### Phase 3: Implementation (Future)
- Make minimal changes for LAN support
- Maintain backward compatibility with localhost
- Test thoroughly before deployment
- Document new setup procedures

---

## 📚 Reference Materials to Review

### Docker Networking
- [ ] Bridge vs Host networking for multi-host
- [ ] Docker Compose networking best practices
- [ ] Port exposure and security considerations

### WebRTC Resources  
- [ ] WebRTC LAN deployment guides
- [ ] STUN/TURN server setup for local networks
- [ ] ICE candidate filtering strategies

### Similar Projects
- [ ] Other browser-based game servers
- [ ] WebRTC game networking implementations
- [ ] CS1.6 server deployment guides

### Network Administration
- [ ] mDNS/Bonjour for service discovery
- [ ] Reverse proxy configurations
- [ ] Load balancing strategies

---

## 🎯 Success Criteria for LAN Deployment

### Must Have
- [ ] Multiple players on different machines can join the same game
- [ ] No hardcoded IP addresses in configurations
- [ ] Automatic server discovery within LAN
- [ ] Stable connections with low latency

### Should Have  
- [ ] Easy deployment across different network configurations
- [ ] Graceful handling of network changes
- [ ] Multiple concurrent games supported
- [ ] Simple administration interface

### Nice to Have
- [ ] Zero-configuration setup
- [ ] Advanced networking features (QoS, etc.)
- [ ] Integration with existing network infrastructure
- [ ] Monitoring and logging capabilities

**Note:** This is research and design phase only - no implementation changes until we fully understand the requirements and implications.
