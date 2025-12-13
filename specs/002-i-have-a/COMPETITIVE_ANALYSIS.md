# Minecraft Hosting Platform - Competitive Analysis & Feature Requirements

## Executive Summary

This document analyzes major Minecraft server hosting platforms to identify essential features, industry standards, and opportunities for differentiation. The analysis covers free hosting (Aternos, Minehut), paid premium hosting (Shockbyte, Apex, BisectHosting, MCProHosting), and open-source solutions (Pterodactyl).

---

## Platform Analysis

### 1. Aternos (Free Tier Leader)

**Model**: 100% Free, ad-supported
**Users**: 125+ million registered users

**Key Features**:

- Java & Bedrock support
- Up to 20 player slots
- Plugin support (Spigot/Paper/Purpur)
- Mod support (Forge/Fabric/Quilt)
- Pre-configured modpack library
- Unlimited backups
- DDoS protection
- Whitelist & ban management

**Limitations**:

- Queue system during peak times
- Auto-shutdown on inactivity
- Lower performance vs paid options
- No FTP access (security choice)
- No priority option (points to Exaroton for paid)

---

### 2. Minehut (Free + Paid)

**Model**: Freemium with paid upgrades

**Free Tier**:

- Unlimited free servers
- 1GB RAM per server
- 10 player slots
- 4-hour daily play limit
- Shared IP (mc.minehut.com)

**Key Features**:

- Java & Bedrock support
- Central server discovery/lobby system
- Custom plugins ecosystem
- Cloud infrastructure
- No technical setup required
- External server hosting option
- Custom subdomain support
- 112,000+ Discord community

**Paid Features**:

- Increased RAM and player slots
- Custom server specs selection
- Priority access

---

### 3. Shockbyte (Premium)

**Model**: Paid, starting $2.99/month

**Control Panel Features**:

- Server Instances (multiple setups, one-click swap)
- Advanced file manager (10GB uploads, folder uploads)
- Smart console (categorized logs: Errors/Warnings/Info/Debug)
- One-click plugin/modpack installer (thousands available)
- Config manager with visual editor
- Built-in backup manager with scheduling
- Task automation system
- Server sharing with custom roles
- Real-time performance graphs (CPU/RAM)
- 185% faster panel performance

**Server Features**:

- Java & Bedrock support
- All server types (Paper, Forge, Fabric, Vanilla)
- Automatic version updates
- Full DDoS protection
- One-click installations

---

### 4. Apex Hosting (Premium)

**Model**: Paid, Multicraft-based panel

**Control Panel Features**:

- Multicraft panel (industry standard)
- Bukkit plugin one-click install (BukGet)
- FTP access from web panel
- User management with roles:
  - Guest (view only)
  - User (chat, basic commands)
  - Moderator (console, player management)
  - Super Moderator (commands, backups)
  - Administrator (full control)
  - Co-Owner (FTP access management)
- Scheduled tasks (backup, restart, broadcast)
- Chat page (communicate without being in-game)
- MySQL database management
- World trimming tool
- Config file editor
- Customizations tab (VAC, Geyser, Java version)

**Additional**:

- Free subdomain
- Server type switching anytime
- Comprehensive knowledgebase

---

### 5. BisectHosting (Premium)

**Model**: Paid, custom Starbase Panel

**Starbase Panel Features**:

- Instance Manager (save/load server setups)
- JAR menu (700+ modpacks one-click)
- Backup Manager (automatic daily + configurable)
- Plugins & Datapacks Manager (Spigot, Modrinth, Bukkit APIs)
- Server health monitoring (graphs/stats)
- Scheduled task automation
- User permission management
- Free MySQL database
- DDoS protection (1.3 Tb/s)
- File manager + FTP client support
- Game switching (100+ games)

**Aurora Update**:

- Modern panel design
- Streamlined server management
- Enhanced instance swapping

---

### 6. Pterodactyl (Open Source)

**Model**: Free, self-hosted

**Architecture**:

- Docker container isolation
- PHP/React/Go stack
- Multi-node support
- Role-based access control

**Features**:

- Wide game support (not just Minecraft)
- Server "Eggs" (templates for server types)
- Resource limits (disk, memory, CPU, bandwidth)
- Real-time monitoring
- Automated backups
- Customizable server settings
- BungeeCord/Velocity proxy support
- Scalable for hosting companies

---

## Feature Categories & Requirements

### TIER 1: Core Features (Must Have)

#### 1.1 Server Lifecycle Management

| Feature            | Description                           | Priority |
| ------------------ | ------------------------------------- | -------- |
| Create server      | One-click server creation             | P0       |
| Start/Stop/Restart | Basic power controls                  | P0       |
| Delete server      | With confirmation                     | P0       |
| Server status      | Real-time status display              | P0       |
| Auto-start         | Server starts when player connects    | P1       |
| Auto-stop          | Shutdown on inactivity (configurable) | P1       |

#### 1.2 Server Configuration

| Feature                  | Description                           | Priority |
| ------------------------ | ------------------------------------- | -------- |
| Server type selection    | Vanilla, Paper, Spigot, Forge, Fabric | P0       |
| Version selection        | All MC versions supported             | P0       |
| server.properties editor | Visual config editor                  | P0       |
| MOTD customization       | Server description                    | P0       |
| Max players              | Player slot configuration             | P0       |
| Gamemode                 | Survival/Creative/Adventure/Spectator | P0       |
| Difficulty               | Peaceful/Easy/Normal/Hard             | P0       |
| World settings           | Seed, level name, spawn protection    | P1       |
| Server icon              | Custom favicon upload                 | P2       |

#### 1.3 Console & Logs

| Feature           | Description                  | Priority |
| ----------------- | ---------------------------- | -------- |
| Live console      | Real-time log streaming      | P0       |
| Command execution | Send commands without /op    | P0       |
| Log filtering     | Error/Warning/Info tabs      | P1       |
| Log download      | Export logs as file          | P1       |
| Log search        | Search within logs           | P2       |
| Log sharing       | Generate shareable log links | P2       |

#### 1.4 Player Management

| Feature              | Description                 | Priority |
| -------------------- | --------------------------- | -------- |
| Online players list  | Real-time player tracking   | P0       |
| Whitelist management | Add/remove whitelist        | P0       |
| Ban management       | Ban/unban players           | P0       |
| OP management        | Grant/revoke operator       | P0       |
| Kick player          | Remove from server          | P0       |
| Player data view     | Health, position, inventory | P1       |

---

### TIER 2: Essential Features (Should Have)

#### 2.1 Backup System

| Feature                  | Description                                      | Priority |
| ------------------------ | ------------------------------------------------ | -------- |
| Manual backup            | One-click backup creation                        | P0       |
| Backup restore           | Restore from backup                              | P0       |
| Automatic backups        | Scheduled backups                                | P1       |
| Backup retention         | Configurable retention policy                    | P1       |
| Backup download          | Download backup files                            | P1       |
| User cloud storage       | Backup to user's Google Drive/Dropbox/OneDrive   | P1       |
| Incremental backups      | Only changed files                               | P2       |

> **Implementation Plan**: See [docs/plans/google-oauth-drive-backup.md](../../docs/plans/google-oauth-drive-backup.md) for the Google OAuth + Google Drive backup implementation details.

#### 2.2 File Management

| Feature           | Description              | Priority |
| ----------------- | ------------------------ | -------- |
| File browser      | Web-based file manager   | P0       |
| File editor       | Edit configs in browser  | P0       |
| File upload       | Upload files via browser | P0       |
| File download     | Download files           | P0       |
| Folder operations | Create/rename/delete     | P0       |
| SFTP access       | External client support  | P1       |
| Zip/Unzip         | Archive management       | P1       |
| Large file upload | Support files >500MB     | P2       |

#### 2.3 Plugin & Mod Management

| Feature              | Description                          | Priority |
| -------------------- | ------------------------------------ | -------- |
| Plugin browser       | Search available plugins             | P0       |
| One-click install    | Install plugins from panel           | P0       |
| Plugin update        | Update to latest versions            | P1       |
| Plugin removal       | Clean uninstall                      | P0       |
| Mod browser          | Search mods (Forge/Fabric)           | P1       |
| Modpack installation | One-click modpack setup              | P1       |
| Version filtering    | Compatible versions only             | P1       |
| Source integration   | Spigot, Modrinth, Bukkit, CurseForge | P1       |

#### 2.4 Resource Management

| Feature           | Description                 | Priority |
| ----------------- | --------------------------- | -------- |
| RAM allocation    | Configurable memory         | P0       |
| CPU monitoring    | Real-time CPU usage         | P0       |
| Memory monitoring | Real-time RAM usage         | P0       |
| Disk usage        | Storage monitoring          | P0       |
| Resource graphs   | Historical usage charts     | P1       |
| Resource alerts   | Notifications on high usage | P2       |

---

### TIER 3: Advanced Features (Nice to Have)

#### 3.1 Multi-Server & Networks

| Feature           | Description                | Priority |
| ----------------- | -------------------------- | -------- |
| Multiple servers  | Manage multiple instances  | P1       |
| Server instances  | Save/load different setups | P1       |
| Proxy support     | BungeeCord/Velocity setup  | P2       |
| Server linking    | Connect servers in network | P2       |
| Cross-server chat | Unified chat system        | P3       |

#### 3.2 Automation & Scheduling

| Feature             | Description                 | Priority |
| ------------------- | --------------------------- | -------- |
| Scheduled tasks     | Cron-like task scheduling   | P1       |
| Scheduled commands  | Run commands at intervals   | P1       |
| Auto-restart        | Scheduled server restarts   | P1       |
| Broadcast messages  | Scheduled announcements     | P2       |
| Webhook integration | Discord/Slack notifications | P2       |

#### 3.3 User & Access Management

| Feature           | Description             | Priority |
| ----------------- | ----------------------- | -------- |
| Sub-users         | Invite others to manage | P1       |
| Role-based access | Permission levels       | P1       |
| Activity log      | Audit trail of actions  | P2       |
| Two-factor auth   | Enhanced security       | P2       |
| API access        | Programmatic control    | P2       |

#### 3.4 Database Management

| Feature            | Description               | Priority |
| ------------------ | ------------------------- | -------- |
| MySQL database     | One database per server   | P1       |
| phpMyAdmin access  | Database management UI    | P1       |
| Database backups   | Include in server backups | P2       |
| Multiple databases | For complex setups        | P3       |

#### 3.5 Domain & Networking

| Feature          | Description                         | Priority |
| ---------------- | ----------------------------------- | -------- |
| Free subdomain   | myserver.platform.com               | P1       |
| Custom domain    | Connect own domain                  | P2       |
| SRV record setup | Custom port support                 | P2       |
| Port mapping     | Additional ports (Votifier, Dynmap) | P2       |
| Firewall rules   | IP whitelisting                     | P2       |

---

### TIER 4: Premium/Differentiating Features

#### 4.1 World Management

| Feature              | Description            | Priority |
| -------------------- | ---------------------- | -------- |
| World upload         | Upload existing world  | P1       |
| World download       | Download world folder  | P1       |
| World reset          | Fresh world generation | P1       |
| World trimming       | Remove unused chunks   | P2       |
| Multiverse support   | Multiple worlds        | P2       |
| Dimension management | Nether/End controls    | P2       |

#### 4.2 Performance & Optimization

| Feature            | Description           | Priority |
| ------------------ | --------------------- | -------- |
| JVM flags editor   | Custom Java arguments | P2       |
| Garbage collection | GC tuning options     | P2       |
| Timings reports    | Performance analysis  | P2       |
| Spark integration  | Profiling support     | P2       |
| Pre-generation     | Chunk pre-generation  | P3       |

#### 4.3 Integrations

| Feature           | Description           | Priority |
| ----------------- | --------------------- | -------- |
| Dynmap support    | Live map integration  | P2       |
| Votifier setup    | Voting rewards        | P2       |
| GeyserMC          | Bedrock crossplay     | P2       |
| Discord bot       | Server status bot     | P3       |
| Server list sites | Auto-publish to lists | P3       |

#### 4.4 Analytics & Insights

| Feature           | Description            | Priority |
| ----------------- | ---------------------- | -------- |
| Player statistics | Join/leave history     | P2       |
| Playtime tracking | Time spent per player  | P2       |
| Peak hours        | When server is busiest | P2       |
| Growth trends     | Player count over time | P3       |
| Geographic data   | Player locations       | P3       |

---

## Competitive Differentiation Opportunities

### What Others Don't Do Well

1. **Real-time Player Data** (Our current strength)
   - Most panels only show player names
   - We show health, position, inventory, equipment
   - Opportunity: Add more player actions (teleport, give items)

2. **Modern UI/UX**
   - Many use dated Multicraft panels
   - Shockbyte's new panel sets the bar
   - Opportunity: React-based modern dashboard

3. **Kubernetes-Native Architecture**
   - No competitor offers true cloud-native scaling
   - Opportunity: Auto-scaling, multi-region, instant provisioning

4. **Developer Experience**
   - Limited API access on most platforms
   - Opportunity: Full REST API, webhooks, SDKs

5. **Instance Switching**
   - Only premium hosts offer this
   - Opportunity: Free-tier instance management

---

## Recommended Implementation Phases

### Phase 1: Foundation (MVP)

- Server lifecycle (create, start, stop, delete)
- Basic configuration (server.properties)
- Console with command execution
- Player list with kick/ban/whitelist
- Manual backups

### Phase 2: Core Experience

- File manager with editor
- Plugin browser with one-click install
- Resource monitoring
- Scheduled tasks
- Automatic backups

### Phase 3: Advanced Features

- Sub-user management
- Multiple server instances
- Database support
- Custom domains
- World management

### Phase 4: Premium Tier

- Proxy/network support
- Advanced analytics
- API access
- Integrations (Dynmap, Votifier)
- Performance optimization tools

---

## Research Sources

- [Aternos](https://aternos.org/:en/)
- [Minehut](https://minehut.com/)
- [Shockbyte Control Panel](https://shockbyte.com/panel)
- [Apex Hosting Features](https://apexminecrafthosting.com/features/)
- [BisectHosting Starbase Panel](https://www.bisecthosting.com/control-panel)
- [Pterodactyl Panel](https://github.com/pterodactyl/panel)
- [Minefort Comparison](https://minefort.com/blog/aternos-vs-minefort)

---

## Appendix: Server Type Support Matrix

| Server Type | Category  | Use Case                      |
| ----------- | --------- | ----------------------------- |
| Vanilla     | Official  | Pure Minecraft experience     |
| Paper       | Plugin    | Performance + plugins         |
| Spigot      | Plugin    | CraftBukkit fork + plugins    |
| Purpur      | Plugin    | Paper fork + extra features   |
| Forge       | Mod       | Most popular mod loader       |
| Fabric      | Mod       | Lightweight, fast updates     |
| NeoForge    | Mod       | Forge fork (community-driven) |
| Quilt       | Mod       | Fabric fork                   |
| BungeeCord  | Proxy     | Server network (legacy)       |
| Waterfall   | Proxy     | BungeeCord fork               |
| Velocity    | Proxy     | Modern proxy (recommended)    |
| Geyser      | Crossplay | Bedrock clients on Java       |

---

_Document generated: December 2024_
_Last updated: Based on competitive analysis of major hosting platforms_
