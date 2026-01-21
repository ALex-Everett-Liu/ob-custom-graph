# Custom Graph

Inspired and forked based on custom-node-size.

# Features

This plugin provides two ways to customize your graph:

1. **Native Graph View Enhancement**: Customize node sizes and attempt to set positions in Obsidian's native graph view
2. **Custom Canvas View**: A dedicated canvas view that shows only nodes with coordinates, allowing full control over positioning

# Usage

## Setting Node Properties

In your note, add properties (`Ctrl+;` or `Ctrl+P` and `Add file property`) like this:

### Node Size

```markdown
---
node_size: 100
---
```

### Node Position

Set custom (x, y) coordinates for nodes:

```markdown
---
node_x: 500
node_y: 300
---
```

### Combined

You can combine both:

```markdown
---
node_size: 100
node_x: 500
node_y: 300
---
```

## Custom Canvas View

The **Custom Canvas View** is a dedicated view that:
- Shows **only nodes that have `node_x` and `node_y` coordinates** in their frontmatter
- Provides full drag-and-drop control over node positions
- Automatically saves positions back to frontmatter when you move nodes
- Shows links between nodes based on your note references
- Supports zoom and pan for navigation

### Opening the Canvas View

1. **Command Palette**: Press `Ctrl+P` (or `Cmd+P` on Mac) and search for "Open Custom Node Canvas"
2. **Ribbon Icon**: Click the network icon in the left ribbon
3. **Command**: Use the command `Open Custom Node Canvas`

### Using the Canvas View

- **Drag nodes** to reposition them (positions are automatically saved)
- **Double-click nodes** to open the corresponding note
- **Scroll wheel** to zoom in/out
- **Click and drag empty space** to pan the canvas
- **Touch gestures** are supported on mobile devices

**Note on positions:** In the native graph view, setting `node_x` and `node_y` will attempt to "pin" the node to that position. In the Custom Canvas View, these coordinates are the definitive positions for your nodes.

## Node Size
Each node has its own weight. This is the number of references to the note that makes the node larger. The plugin overwrites this with the value you set in the `node_size` property (numeric type).

## Node Position

### Native Graph View
The plugin attempts to pin nodes to specific coordinates by manipulating Obsidian's internal graph view state. Nodes with `node_x` and `node_y` set will be fixed at those positions, while other nodes continue to use the force-directed layout algorithm.

### Custom Canvas View
The Custom Canvas View provides a dedicated canvas that only displays nodes with coordinates. This gives you complete control over node positioning without interference from force-directed layout algorithms. Positions are stored directly in your note's frontmatter and persist across sessions.

# Restrictions

- **Node Size**: Experimentally, I found that visually the node changes in the range `[6, 100]`.
- **Node Position**: Position coordinates are in the graph view's coordinate system. The exact range depends on your graph view zoom and pan settings. Start with values like `node_x: 500, node_y: 300` and adjust as needed.

**Warning:** Using variables of a different type (not `numeric`) causes unexpected behavior.

**Note:** Since Obsidian's graph view uses an internal force-directed layout algorithm, custom positions may be overridden during graph interactions (zooming, panning, etc.). The plugin continuously attempts to reapply positions, but some limitations may exist due to Obsidian's internal implementation.
