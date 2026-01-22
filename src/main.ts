import { App, Plugin, WorkspaceLeaf, PluginSettingTab, Setting } from 'obsidian';
import { ObsidianView } from 'src/types';
import { CustomCanvasView } from 'src/canvas-view';

export interface CustomNodeSizeSettings {
	loadOnlyCurrentDirectory: boolean;
}

const DEFAULT_SETTINGS: CustomNodeSizeSettings = {
	loadOnlyCurrentDirectory: false
};

export default class CustomNodeSize extends Plugin {
	settings: CustomNodeSizeSettings;
	private updateInterval: number | null = null;

	async onload() {
		// Load settings
		await this.loadSettings();

		// Register custom canvas view
		// Pass a function that gets settings dynamically to ensure we always have the latest settings
		this.registerView('custom-node-canvas', (leaf: WorkspaceLeaf) => {
			// Ensure settings are loaded before creating view
			if (!this.settings) {
				console.warn('[CustomNodeSize] Settings not loaded, using defaults');
				this.settings = Object.assign({}, DEFAULT_SETTINGS);
			}
			return new CustomCanvasView(leaf, this.settings, this);
		});

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

		// Add settings tab
		this.addSettingTab(new CustomNodeSizeSettingTab(this.app, this));

		// If canvas views already exist (plugin reload), reinitialize them
		this.reinitializeExistingViews();
	}

	private reinitializeExistingViews(): void {
		const existingLeaves = this.app.workspace.getLeavesOfType('custom-node-canvas');
		for (const leaf of existingLeaves) {
			const view = leaf.view as CustomCanvasView;
			if (view) {
				// Force view to refresh settings and reload
				view.updateSettings(this.settings);
				// Trigger a re-render after a short delay
				setTimeout(() => {
					if (view && view.contentEl) {
						view.updateSettings(this.settings);
					}
				}, 100);
			}
		}
	}

	async loadSettings() {
		const savedData = await this.loadData();
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Reload canvas view if it exists to apply new settings
		const existingLeaves = this.app.workspace.getLeavesOfType('custom-node-canvas');
		for (const leaf of existingLeaves) {
			const view = leaf.view as CustomCanvasView;
			if (view) {
				view.updateSettings(this.settings);
			}
		}
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

class CustomNodeSizeSettingTab extends PluginSettingTab {
	plugin: CustomNodeSize;

	constructor(app: App, plugin: CustomNodeSize) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Custom Graph Settings' });

		new Setting(containerEl)
			.setName('Load only current directory')
			.setDesc('When enabled, only nodes (markdown files) in the current directory will be loaded in the canvas view. The current directory is determined by the active file in the workspace.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.loadOnlyCurrentDirectory)
				.onChange(async (value) => {
					this.plugin.settings.loadOnlyCurrentDirectory = value;
					await this.plugin.saveSettings();
				}));
	}
}
