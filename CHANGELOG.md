
## [Unreleased]

## [1.0.0] - 2026-01-22

### Added

- **Custom Node Size**: Ability to customize node sizes in Obsidian's native graph view using `node_size` frontmatter property
- **Node Position Support**: Ability to set custom (x, y) coordinates for nodes using `node_x` and `node_y` frontmatter properties in the native graph view
- **Custom Canvas View**: New dedicated canvas view (`custom-node-canvas`) that provides full control over node positioning
  - Shows only nodes that have coordinates set in their frontmatter
  - Drag-and-drop functionality to reposition nodes
  - Automatic saving of node positions to frontmatter when moved
  - Zoom and pan controls for canvas navigation
  - Visual grid background for better positioning reference
  - Link visualization between nodes based on note references
  - Double-click nodes to open corresponding notes
  - Touch gesture support for mobile devices
- **Command**: "Open Custom Node Canvas" command accessible via Command Palette
- **Ribbon Icon**: Network icon in the left ribbon to quickly open the custom canvas view
- **Metadata Integration**: Automatic updates when note metadata changes
- **Real-time Updates**: Native graph view updates node sizes and positions in real-time as metadata changes

### Changed

- Plugin now supports both native graph view enhancements and custom canvas view
- README updated with comprehensive documentation for both features

### Technical Details

- Custom view implementation using Obsidian's `ItemView` API
- Canvas-based rendering with HTML5 Canvas API
- Frontmatter parsing and modification for position persistence
- Event-driven architecture for metadata change detection
