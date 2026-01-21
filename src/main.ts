import { Plugin, WorkspaceLeaf } from 'obsidian';
import { ObsidianView } from 'src/types';
import { CustomCanvasView } from 'src/canvas-view';

export default class CustomNodeSize extends Plugin {
	private updateInterval: number | null = null;

	async onload() {
		// Register custom canvas view
		this.registerView('custom-node-canvas', (leaf: WorkspaceLeaf) => new CustomCanvasView(leaf));

		// Add command to open custom canvas view
		this.addCommand({
			id: 'open-custom-node-canvas',
			name: 'Open Custom Node Canvas',
			callback: () => {
				this.openCustomCanvasView();
			}
		});

		// Add ribbon icon to open canvas view
		this.addRibbonIcon('network', 'Open Custom Node Canvas', () => {
			this.openCustomCanvasView();
		});
		this.registerEvent(
			this.app.workspace.on('layout-change', () => {
				const leaf = this.getGraphLeaf();
				if (!leaf) return;

				// Clear any existing interval
				if (this.updateInterval) {
					clearInterval(this.updateInterval);
				}

				// Without interval changes do not apply.
				this.updateInterval = window.setInterval(() => {
					// @ts-ignore
					const view = leaf.view as ObsidianView;
					if (!view?.renderer) return;

					this.updateNodeSizes(view);
					this.updateNodePositions(view);
				}, 1);
			})
		);

		// Also update when metadata changes (frontmatter edits)
		this.registerEvent(
			this.app.metadataCache.on('changed', () => {
				const leaf = this.getGraphLeaf();
				if (!leaf) return;

				// @ts-ignore
				const view = leaf.view as ObsidianView;
				if (!view?.renderer) return;

				this.updateNodeSizes(view);
				this.updateNodePositions(view);
			})
		);
	}

	onunload() {
		if (this.updateInterval) {
			clearInterval(this.updateInterval);
			this.updateInterval = null;
		}
	}

	private async openCustomCanvasView(): Promise<void> {
		const existingLeaf = this.app.workspace.getLeavesOfType('custom-node-canvas')[0];
		
		if (existingLeaf) {
			// If view already exists, reveal it
			this.app.workspace.revealLeaf(existingLeaf);
		} else {
			// Create new leaf
			const leaf = this.app.workspace.getRightLeaf(false);
			await leaf.setViewState({
				type: 'custom-node-canvas',
				active: true
			});
			this.app.workspace.revealLeaf(leaf);
		}
	}

	private getGraphLeaf() {
		const leafs = this.app.workspace.getLeavesOfType('graph');
		return leafs.length === 1 ? leafs.first() : null;
	}

	private updateNodeSizes(view: ObsidianView) {
		const { renderer } = view;
		renderer?.nodes.forEach((node) => {
			const file = this.app.vault.getFileByPath(node.id);
			if (!file) return;

			const fileCache = this.app.metadataCache.getFileCache(file);
			const nodeSize = fileCache?.frontmatter?.node_size;
			if (nodeSize) {
				node.weight = nodeSize;
			}
		});
	}

	private updateNodePositions(view: ObsidianView) {
		const { renderer } = view;
		if (!renderer?.nodes) return;

		let hasPositionedNodes = false;

		renderer.nodes.forEach((node) => {
			const file = this.app.vault.getFileByPath(node.id);
			if (!file) return;

			const fileCache = this.app.metadataCache.getFileCache(file);
			const frontmatter = fileCache?.frontmatter;

			if (!frontmatter) {
				// If no frontmatter, ensure node is not fixed
				if (node.fx !== undefined || node.fy !== undefined) {
					node.fx = null;
					node.fy = null;
				}
				return;
			}

			const nodeX = frontmatter.node_x;
			const nodeY = frontmatter.node_y;

			// If both x and y are specified, fix the node position
			if (typeof nodeX === 'number' && typeof nodeY === 'number') {
				node.fx = nodeX;
				node.fy = nodeY;
				hasPositionedNodes = true;

				// Also set current position if not already set
				if (node.x === undefined || node.y === undefined) {
					node.x = nodeX;
					node.y = nodeY;
				}
			} else {
				// If position is not specified, allow free movement
				node.fx = null;
				node.fy = null;
			}
		});

		// If we have positioned nodes, restart the force simulation to apply changes
		if (hasPositionedNodes && renderer.force) {
			try {
				// Restart the simulation to apply fixed positions
				renderer.force.restart?.();
				// Set alpha target to keep simulation active for smooth transitions
				renderer.force.alphaTarget?.(0.1);
			} catch (e) {
				// Force simulation might not be accessible, that's okay
				console.debug('Could not access force simulation:', e);
			}
		}
	}
}
