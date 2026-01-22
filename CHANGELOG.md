
## [Unreleased]

## [1.0.1] - 2026-01-22

### Added

- **Directory Filtering Option**: Added setting to load only nodes from the current directory in Custom Canvas View
  - New setting "Load only current directory" in plugin settings
  - When enabled, only markdown files in the active file's directory (and subdirectories) are loaded
  - Helps prevent loading all nodes throughout large vaults
  - Automatically reloads nodes when the active file changes
  - Setting persists across sessions

### Changed

- Custom Canvas View now accepts settings parameter for configuration
- Settings tab added to plugin settings with toggle for directory filtering

### Technical Details

- Settings stored using Obsidian's `loadData()` and `saveData()` API
- Current directory determined from the active file in workspace
- Filtering applies to subdirectories recursively
- Canvas view automatically updates when settings change

### Added

- **Zoom and Center Input Controls**: Added input boxes for adjusting zoom level and center coordinates
  - Zoom input field (range: 0.1 to 5.0) for precise zoom control
  - Center X and Center Y input fields for setting the world coordinate at the center of the canvas
  - Controls panel displayed at the top of the canvas view
  - Real-time synchronization between input values and canvas state
  - Inputs automatically update when zooming/panning with mouse actions

### Changed

- Canvas view now includes a controls panel above the canvas for manual input adjustments
- Zoom and pan operations now update the input fields to reflect current state

### Fixed

- Fixed initialization error where inputs were accessed before canvas was ready
- Added safety checks to prevent errors when canvas dimensions are not yet available

### Technical Details

- Controls panel uses flexbox layout with Obsidian theme integration
- Input validation ensures zoom stays within bounds (0.1-5.0)
- Center coordinate calculation converts between screen and world coordinates
- Bidirectional sync prevents infinite update loops using `isUpdatingFromInputs` flag

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
