import { ItemView, WorkspaceLeaf, TFile, Plugin } from 'obsidian';
import { CustomNodeSizeSettings, CustomNodeSize } from 'src/main';
import { CanvasEdge } from 'src/types';

export interface CanvasNode {
	id: string;
	path: string;
	x: number;
	y: number;
	size: number;
	label: string;
}

export class CustomCanvasView extends ItemView {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private nodes: Map<string, CanvasNode> = new Map();
	private edges: Map<string, CanvasEdge> = new Map(); // key: "source|target"
	private selectedNode: CanvasNode | null = null;
	private edgeSourceNode: CanvasNode | null = null; // node selected for creating edge
	private hoveredEdge: CanvasEdge | null = null;
	private isDragging: boolean = false;
	private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
	private panOffset: { x: number; y: number } = { x: 0, y: 0 };
	private isPanning: boolean = false;
	private lastPanPoint: { x: number; y: number } = { x: 0, y: 0 };
	private zoom: number = 1.0;
	private controlsPanel: HTMLElement;
	private zoomInput: HTMLInputElement;
	private centerXInput: HTMLInputElement;
	private centerYInput: HTMLInputElement;
	private isUpdatingFromInputs: boolean = false;
	private settings: CustomNodeSizeSettings;
	private plugin: CustomNodeSize;

	constructor(leaf: WorkspaceLeaf, settings: CustomNodeSizeSettings, plugin: CustomNodeSize) {
		super(leaf);
		this.plugin = plugin;
		this.settings = settings || { loadOnlyCurrentDirectory: false };
	}

	private getSettings(): CustomNodeSizeSettings {
		// Always get fresh settings from plugin if available
		if (this.plugin?.settings) {
			return this.plugin.settings;
		}
		// Fallback to stored settings
		return this.settings || { loadOnlyCurrentDirectory: false };
	}

	updateSettings(settings: CustomNodeSizeSettings): void {
		this.settings = settings;
		// Reload nodes with new settings
		this.loadNodes();
		this.render();
	}

	getViewType(): string {
		return 'custom-node-canvas';
	}

	getDisplayText(): string {
		return 'Custom Node Canvas';
	}

	getIcon(): string {
		return 'network';
	}

	async onOpen(): Promise<void> {
		// Ensure we have fresh settings from plugin
		if (this.plugin?.settings) {
			this.settings = this.plugin.settings;
		} else if (!this.settings) {
			console.warn('[CustomCanvasView] Plugin not available, using default settings');
			this.settings = { loadOnlyCurrentDirectory: false };
		}
		
		const container = this.contentEl;
		container.empty();
		container.addClass('canvas-view-container');

		// Create controls panel
		this.createControlsPanel(container);

		// Create canvas wrapper
		const canvasWrapper = container.createDiv('canvas-wrapper');
		
		// Create canvas
		this.canvas = canvasWrapper.createEl('canvas', {
			attr: {
				style: 'width: 100%; height: 100%; display: block; cursor: grab; pointer-events: auto;'
			}
		});
		this.canvas.style.width = '100%';
		this.canvas.style.height = '100%';
		this.canvas.style.pointerEvents = 'auto';

		this.ctx = this.canvas.getContext('2d')!;
		if (!this.ctx) {
			console.error('[CustomCanvasView] Failed to get canvas context');
			return;
		}
		
		// Set canvas size
		this.resizeCanvas();

		// Load nodes from metadata
		this.loadNodes();

		// Setup event listeners
		this.setupEventListeners();

		// Listen for metadata changes
		this.registerEvent(
			this.app.metadataCache.on('changed', () => {
				this.loadNodes();
				this.render();
			})
		);

		// Listen for file changes
		this.registerEvent(
			this.app.vault.on('modify', () => {
				this.loadNodes();
				this.render();
			})
		);

		// Listen for active file changes (to reload nodes if directory filtering is enabled)
		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				const settings = this.getSettings();
				if (settings.loadOnlyCurrentDirectory) {
					this.loadNodes();
					this.render();
				}
			})
		);

		// Wait for canvas to be properly sized before initial render
		// Use requestAnimationFrame to ensure the view is laid out
		requestAnimationFrame(() => {
			requestAnimationFrame(() => {
				// Double RAF ensures layout is complete
				this.resizeCanvas();
				
				// Only render if canvas has valid size
				if (this.canvas.width > 0 && this.canvas.height > 0) {
					this.render();
					this.updateInputsFromState();
				} else {
					console.error('[CustomCanvasView] Canvas has zero size, retrying...');
					// Try one more time after a short delay
					setTimeout(() => {
						this.resizeCanvas();
						if (this.canvas.width > 0 && this.canvas.height > 0) {
							this.render();
							this.updateInputsFromState();
						} else {
							console.error('[CustomCanvasView] Failed to get canvas size after retry');
						}
					}, 100);
				}
			});
		});
	}

	async onClose(): Promise<void> {
		// Cleanup if needed
	}

	private createControlsPanel(container: HTMLElement): void {
		this.controlsPanel = container.createDiv('canvas-controls-panel');
		
		// Zoom control
		const zoomGroup = this.controlsPanel.createDiv('control-group');
		zoomGroup.createSpan({ text: 'Zoom:', cls: 'control-label' });
		this.zoomInput = zoomGroup.createEl('input', {
			type: 'number',
			attr: {
				step: '0.1',
				min: '0.1',
				max: '5',
				value: this.zoom.toFixed(2)
			},
			cls: 'control-input'
		});

		// Center X control
		const centerXGroup = this.controlsPanel.createDiv('control-group');
		centerXGroup.createSpan({ text: 'Center X:', cls: 'control-label' });
		this.centerXInput = centerXGroup.createEl('input', {
			type: 'number',
			attr: {
				step: '1',
				value: '0'
			},
			cls: 'control-input'
		});

		// Center Y control
		const centerYGroup = this.controlsPanel.createDiv('control-group');
		centerYGroup.createSpan({ text: 'Center Y:', cls: 'control-label' });
		this.centerYInput = centerYGroup.createEl('input', {
			type: 'number',
			attr: {
				step: '1',
				value: '0'
			},
			cls: 'control-input'
		});

		// Setup input event listeners
		this.zoomInput.addEventListener('change', () => this.updateZoomFromInput());
		this.zoomInput.addEventListener('input', () => this.updateZoomFromInput());
		this.centerXInput.addEventListener('change', () => this.updateCenterFromInputs());
		this.centerYInput.addEventListener('change', () => this.updateCenterFromInputs());

		// Initial values will be set after canvas is initialized in onOpen()
	}

	private resizeCanvas(): void {
		if (!this.canvas) {
			console.warn('[CustomCanvasView] resizeCanvas() called but canvas is null');
			return;
		}
		const rect = this.canvas.getBoundingClientRect();
		
		// If canvas has zero size, try to get size from container or use defaults
		if (rect.width === 0 || rect.height === 0) {
			const container = this.canvas.parentElement;
			if (container) {
				const containerRect = container.getBoundingClientRect();
				if (containerRect.width > 0 && containerRect.height > 0) {
					this.canvas.width = containerRect.width * window.devicePixelRatio;
					this.canvas.height = containerRect.height * window.devicePixelRatio;
				} else {
					// Use viewport size as fallback
					const viewportWidth = window.innerWidth || 800;
					const viewportHeight = window.innerHeight || 600;
					this.canvas.width = viewportWidth * window.devicePixelRatio;
					this.canvas.height = viewportHeight * window.devicePixelRatio;
				}
			} else {
				// Fallback to default size
				this.canvas.width = 800 * window.devicePixelRatio;
				this.canvas.height = 600 * window.devicePixelRatio;
			}
		} else {
			this.canvas.width = rect.width * window.devicePixelRatio;
			this.canvas.height = rect.height * window.devicePixelRatio;
		}
		
		// Reset context scale and reapply
		this.ctx.setTransform(1, 0, 0, 1, 0, 0);
		this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
	}

	private loadNodes(): void {
		this.nodes.clear();
		this.edges.clear();
		
		// Get fresh settings
		const settings = this.getSettings();
		
		let files = this.app.vault.getMarkdownFiles();
		
		// Filter by current directory if setting is enabled
		if (settings.loadOnlyCurrentDirectory) {
			const currentDirectory = this.getCurrentDirectory();
			if (currentDirectory) {
				files = files.filter(file => {
					const fileDir = file.parent?.path || '';
					return fileDir === currentDirectory || fileDir.startsWith(currentDirectory + '/');
				});
			} else {
				console.warn('[CustomCanvasView] No current directory found, loading all files');
			}
		}
		
		for (const file of files) {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache?.frontmatter) continue;

			const nodeX = cache.frontmatter.node_x;
			const nodeY = cache.frontmatter.node_y;
			const nodeSize = cache.frontmatter.node_size || 20;

			// Only include nodes with coordinates
			if (typeof nodeX === 'number' && typeof nodeY === 'number') {
				const node: CanvasNode = {
					id: file.path,
					path: file.path,
					x: nodeX,
					y: nodeY,
					size: nodeSize,
					label: file.basename
				};
				this.nodes.set(file.path, node);

				// Load edges from frontmatter
				const edges = cache.frontmatter.edges;
				if (Array.isArray(edges)) {
					for (const targetPath of edges) {
						if (typeof targetPath === 'string' && targetPath !== file.path) {
							// Normalize path (remove .md extension if present, or add it)
							let normalizedTarget = targetPath;
							if (!normalizedTarget.endsWith('.md')) {
								normalizedTarget = normalizedTarget + '.md';
							}
							
							// Check if target file exists
							const targetFile = this.app.vault.getAbstractFileByPath(normalizedTarget);
							if (targetFile) {
								const edgeKey = this.getEdgeKey(file.path, normalizedTarget);
								if (!this.edges.has(edgeKey)) {
									this.edges.set(edgeKey, {
										source: file.path,
										target: normalizedTarget
									});
								}
							}
						}
					}
				}
			}
		}
	}

	private getCurrentDirectory(): string | null {
		// Get the active file from the workspace
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile && activeFile.parent) {
			return activeFile.parent.path;
		}
		// If no active file, try to get directory from any open markdown file
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		if (leaves.length > 0) {
			const view = leaves[0].view;
			// @ts-ignore
			const file = view?.file;
			if (file && file.parent) {
				return file.parent.path;
			}
		}
		return null;
	}

	private setupEventListeners(): void {
		// Mouse events
		this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
		this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
		this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
		this.canvas.addEventListener('mouseleave', this.onMouseLeave.bind(this));
		this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
		this.canvas.addEventListener('wheel', this.onWheel.bind(this), { passive: false });
		this.canvas.addEventListener('contextmenu', (e) => {
			// Only prevent default for right-clicks on edges, allow normal context menu otherwise
			const pos = this.getMousePos(e);
			const edge = this.getEdgeAt(pos.x, pos.y);
			if (edge) {
				e.preventDefault();
			}
		});

		// Touch events for mobile
		this.canvas.addEventListener('touchstart', this.onTouchStart.bind(this));
		this.canvas.addEventListener('touchmove', this.onTouchMove.bind(this));
		this.canvas.addEventListener('touchend', this.onTouchEnd.bind(this));

		// Window resize
		window.addEventListener('resize', () => {
			this.resizeCanvas();
			this.updateInputsFromState();
			this.render();
		});

		// Keyboard events
		window.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && this.edgeSourceNode) {
				this.edgeSourceNode = null;
				this.canvas.style.cursor = 'grab';
				this.render();
			}
		});
	}

	private getMousePos(e: MouseEvent | TouchEvent): { x: number; y: number } {
		const rect = this.canvas.getBoundingClientRect();
		if (e instanceof MouseEvent) {
			return {
				x: e.clientX - rect.left,
				y: e.clientY - rect.top
			};
		} else {
			const touch = e.touches[0] || e.changedTouches[0];
			return {
				x: touch.clientX - rect.left,
				y: touch.clientY - rect.top
			};
		}
	}

	private worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
		return {
			x: (worldX + this.panOffset.x) * this.zoom,
			y: (worldY + this.panOffset.y) * this.zoom
		};
	}

	private screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
		return {
			x: screenX / this.zoom - this.panOffset.x,
			y: screenY / this.zoom - this.panOffset.y
		};
	}

	private getCenterWorldCoordinate(): { x: number; y: number } {
		if (!this.canvas || !this.canvas.width || !this.canvas.height) {
			return { x: 0, y: 0 };
		}
		const width = this.canvas.width / window.devicePixelRatio;
		const height = this.canvas.height / window.devicePixelRatio;
		return this.screenToWorld(width / 2, height / 2);
	}

	private setCenterWorldCoordinate(worldX: number, worldY: number): void {
		if (!this.canvas || !this.canvas.width || !this.canvas.height) {
			return;
		}
		const width = this.canvas.width / window.devicePixelRatio;
		const height = this.canvas.height / window.devicePixelRatio;
		const centerScreenX = width / 2;
		const centerScreenY = height / 2;
		
		// Calculate panOffset so that (worldX, worldY) appears at screen center
		this.panOffset.x = centerScreenX / this.zoom - worldX;
		this.panOffset.y = centerScreenY / this.zoom - worldY;
	}

	private updateZoomFromInput(): void {
		if (this.isUpdatingFromInputs) return;
		
		const newZoom = parseFloat(this.zoomInput.value);
		if (isNaN(newZoom)) return;
		
		const clampedZoom = Math.max(0.1, Math.min(5, newZoom));
		
		// Get current center before zoom change
		const centerBefore = this.getCenterWorldCoordinate();
		
		// Update zoom
		this.zoom = clampedZoom;
		
		// Adjust pan to keep the same center point
		this.setCenterWorldCoordinate(centerBefore.x, centerBefore.y);
		
		// Update input to reflect clamped value
		this.isUpdatingFromInputs = true;
		this.zoomInput.value = clampedZoom.toFixed(2);
		this.isUpdatingFromInputs = false;
		
		this.render();
	}

	private updateCenterFromInputs(): void {
		if (this.isUpdatingFromInputs) return;
		
		const centerX = parseFloat(this.centerXInput.value);
		const centerY = parseFloat(this.centerYInput.value);
		
		if (isNaN(centerX) || isNaN(centerY)) return;
		
		this.setCenterWorldCoordinate(centerX, centerY);
		this.render();
	}

	private updateInputsFromState(): void {
		if (this.isUpdatingFromInputs || !this.zoomInput || !this.canvas || !this.canvas.width || !this.canvas.height) {
			return;
		}
		
		this.isUpdatingFromInputs = true;
		
		const center = this.getCenterWorldCoordinate();
		this.zoomInput.value = this.zoom.toFixed(2);
		this.centerXInput.value = Math.round(center.x).toString();
		this.centerYInput.value = Math.round(center.y).toString();
		
		this.isUpdatingFromInputs = false;
	}

	private getNodeAt(x: number, y: number): CanvasNode | null {
		const worldPos = this.screenToWorld(x, y);
		
		// Check nodes in reverse order (top to bottom)
		const nodesArray = Array.from(this.nodes.values());
		for (let i = nodesArray.length - 1; i >= 0; i--) {
			const node = nodesArray[i];
			const screenPos = this.worldToScreen(node.x, node.y);
			const distance = Math.sqrt(
				Math.pow(x - screenPos.x, 2) + Math.pow(y - screenPos.y, 2)
			);
			
			if (distance <= node.size / 2) {
				return node;
			}
		}
		
		return null;
	}

	private getEdgeAt(x: number, y: number): CanvasEdge | null {
		const threshold = 5; // pixels
		let closestEdge: CanvasEdge | null = null;
		let closestDistance = Infinity;

		for (const edge of this.edges.values()) {
			const sourceNode = this.nodes.get(edge.source);
			const targetNode = this.nodes.get(edge.target);
			
			if (!sourceNode || !targetNode) continue;

			const start = this.worldToScreen(sourceNode.x, sourceNode.y);
			const end = this.worldToScreen(targetNode.x, targetNode.y);

			// Calculate distance from point to line segment
			const A = x - start.x;
			const B = y - start.y;
			const C = end.x - start.x;
			const D = end.y - start.y;

			const dot = A * C + B * D;
			const lenSq = C * C + D * D;
			let param = -1;
			if (lenSq !== 0) param = dot / lenSq;

			let xx, yy;
			if (param < 0) {
				xx = start.x;
				yy = start.y;
			} else if (param > 1) {
				xx = end.x;
				yy = end.y;
			} else {
				xx = start.x + param * C;
				yy = start.y + param * D;
			}

			const dx = x - xx;
			const dy = y - yy;
			const distance = Math.sqrt(dx * dx + dy * dy);

			if (distance < threshold && distance < closestDistance) {
				closestDistance = distance;
				closestEdge = edge;
			}
		}

		return closestEdge;
	}

	private onMouseDown(e: MouseEvent): void {
		const pos = this.getMousePos(e);
		const node = this.getNodeAt(pos.x, pos.y);
		const edge = this.getEdgeAt(pos.x, pos.y);

		// Right-click on edge to delete (only if not clicking on a node)
		if (e.button === 2 && edge && !node) {
			e.preventDefault();
			this.deleteEdge(edge);
			return;
		}

		// Shift+click on edge to delete (only if not clicking on a node)
		if (e.shiftKey && edge && !node) {
			e.preventDefault();
			this.deleteEdge(edge);
			return;
		}

		// Shift+click on node to start edge creation
		if (e.shiftKey && node) {
			e.preventDefault();
			this.edgeSourceNode = node;
			this.canvas.style.cursor = 'crosshair';
			this.render();
			return;
		}

		if (node) {
			// Start dragging node
			this.selectedNode = node;
			this.isDragging = true;
			const screenPos = this.worldToScreen(node.x, node.y);
			this.dragOffset = {
				x: pos.x - screenPos.x,
				y: pos.y - screenPos.y
			};
			this.canvas.style.cursor = 'grabbing';
		} else {
			// Start panning
			this.isPanning = true;
			this.lastPanPoint = pos;
			this.canvas.style.cursor = 'grabbing';
		}
	}

	private onMouseMove(e: MouseEvent): void {
		const pos = this.getMousePos(e);

		// Update cursor and hovered edge
		if (this.edgeSourceNode) {
			const node = this.getNodeAt(pos.x, pos.y);
			this.canvas.style.cursor = node && node !== this.edgeSourceNode ? 'pointer' : 'crosshair';
		} else if (e.shiftKey) {
			const edge = this.getEdgeAt(pos.x, pos.y);
			this.canvas.style.cursor = edge ? 'not-allowed' : 'crosshair';
		} else {
			const edge = this.getEdgeAt(pos.x, pos.y);
			const node = this.getNodeAt(pos.x, pos.y);
			if (edge) {
				this.canvas.style.cursor = 'pointer';
			} else if (node) {
				this.canvas.style.cursor = 'grab';
			} else {
				this.canvas.style.cursor = 'grab';
			}
		}

		// Update hovered edge
		const edge = this.getEdgeAt(pos.x, pos.y);
		if (edge !== this.hoveredEdge) {
			this.hoveredEdge = edge;
			this.render();
		}

		if (this.isDragging && this.selectedNode) {
			const worldPos = this.screenToWorld(
				pos.x - this.dragOffset.x,
				pos.y - this.dragOffset.y
			);
			this.selectedNode.x = worldPos.x;
			this.selectedNode.y = worldPos.y;
			this.render();
		} else if (this.isPanning) {
			const deltaX = pos.x - this.lastPanPoint.x;
			const deltaY = pos.y - this.lastPanPoint.y;
			this.panOffset.x += deltaX / this.zoom;
			this.panOffset.y += deltaY / this.zoom;
			this.lastPanPoint = pos; // Update for next move
			this.updateInputsFromState();
			this.render();
		} else if (this.edgeSourceNode) {
			// Store position for edge preview
			this.lastPanPoint = pos;
			// Update edge preview
			this.render();
		}
	}

	private onMouseUp(e: MouseEvent): void {
		const pos = this.getMousePos(e);

		if (this.edgeSourceNode) {
			// Complete edge creation
			const targetNode = this.getNodeAt(pos.x, pos.y);
			if (targetNode && targetNode !== this.edgeSourceNode) {
				this.createEdge(this.edgeSourceNode, targetNode);
			}
			this.edgeSourceNode = null;
			this.canvas.style.cursor = 'grab';
			this.render();
		}

		if (this.isDragging && this.selectedNode) {
			// Save position to frontmatter
			this.saveNodePosition(this.selectedNode);
			this.selectedNode = null;
			this.isDragging = false;
		}
		
		if (this.isPanning) {
			this.isPanning = false;
		}
		
		if (!this.edgeSourceNode) {
			this.canvas.style.cursor = 'grab';
		}
	}

	private onDoubleClick(e: MouseEvent): void {
		const pos = this.getMousePos(e);
		const node = this.getNodeAt(pos.x, pos.y);

		if (node) {
			// Open the file
			const file = this.app.vault.getAbstractFileByPath(node.path) as TFile;
			if (file) {
				this.app.workspace.openLinkText(node.path, '', false);
			}
		}
	}

	private onWheel(e: WheelEvent): void {
		e.preventDefault();
		const pos = this.getMousePos(e);
		const worldPos = this.screenToWorld(pos.x, pos.y);

		const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
		this.zoom *= zoomFactor;
		this.zoom = Math.max(0.1, Math.min(5, this.zoom)); // Limit zoom

		// Adjust pan to zoom towards mouse position
		const newWorldPos = this.screenToWorld(pos.x, pos.y);
		this.panOffset.x += worldPos.x - newWorldPos.x;
		this.panOffset.y += worldPos.y - newWorldPos.y;

		this.updateInputsFromState();
		this.render();
	}

	private onTouchStart(e: TouchEvent): void {
		if (e.touches.length === 1) {
			const pos = this.getMousePos(e);
			const node = this.getNodeAt(pos.x, pos.y);

			if (node) {
				this.selectedNode = node;
				this.isDragging = true;
				const screenPos = this.worldToScreen(node.x, node.y);
				this.dragOffset = {
					x: pos.x - screenPos.x,
					y: pos.y - screenPos.y
				};
			} else {
				this.isPanning = true;
				this.lastPanPoint = pos;
			}
		}
	}

	private onTouchMove(e: TouchEvent): void {
		if (e.touches.length === 1 && (this.isDragging || this.isPanning)) {
			const pos = this.getMousePos(e);

			if (this.isDragging && this.selectedNode) {
				const worldPos = this.screenToWorld(
					pos.x - this.dragOffset.x,
					pos.y - this.dragOffset.y
				);
				this.selectedNode.x = worldPos.x;
				this.selectedNode.y = worldPos.y;
				this.render();
			} else if (this.isPanning) {
				const deltaX = pos.x - this.lastPanPoint.x;
				const deltaY = pos.y - this.lastPanPoint.y;
				this.panOffset.x += deltaX / this.zoom;
				this.panOffset.y += deltaY / this.zoom;
				this.lastPanPoint = pos;
				this.updateInputsFromState();
				this.render();
			}
		}
	}

	private onMouseLeave(e: MouseEvent): void {
		// Cancel edge creation if mouse leaves canvas
		if (this.edgeSourceNode) {
			this.edgeSourceNode = null;
			this.canvas.style.cursor = 'grab';
			this.render();
		}
		this.onMouseUp(e);
	}

	private onTouchEnd(e: TouchEvent): void {
		if (this.isDragging && this.selectedNode) {
			this.saveNodePosition(this.selectedNode);
			this.selectedNode = null;
			this.isDragging = false;
		}
		
		if (this.isPanning) {
			this.isPanning = false;
		}
	}

	private createEdge(source: CanvasNode, target: CanvasNode): void {
		const edgeKey = this.getEdgeKey(source.path, target.path);
		
		// Check if edge already exists
		if (this.edges.has(edgeKey)) {
			return;
		}

		const edge: CanvasEdge = {
			source: source.path,
			target: target.path
		};

		this.edges.set(edgeKey, edge);
		
		// Save edges to source node's frontmatter
		this.saveEdgesToFrontmatter(source.path);
		
		this.render();
	}

	private deleteEdge(edge: CanvasEdge): void {
		const edgeKey = this.getEdgeKey(edge.source, edge.target);
		this.edges.delete(edgeKey);
		
		// Update frontmatter for source node only (edges are stored on source)
		this.saveEdgesToFrontmatter(edge.source);
		
		this.render();
	}

	private getEdgesForNode(nodePath: string): string[] {
		// Only return edges where this node is the source
		const targetPaths: string[] = [];
		for (const edge of this.edges.values()) {
			if (edge.source === nodePath) {
				targetPaths.push(edge.target);
			}
		}
		return targetPaths;
	}

	private async saveEdgesToFrontmatter(nodePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(nodePath) as TFile;
		if (!file) return;

		try {
			let content = await this.app.vault.read(file);
			const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
			const match = content.match(frontmatterRegex);

			const edges = this.getEdgesForNode(nodePath);

			if (match) {
				// Update existing frontmatter
				let frontmatter = match[1];
				
				// Update or add edges
				if (edges.length > 0) {
					const edgesYaml = edges.length === 1 
						? `edges: ["${edges[0]}"]`
						: `edges:\n${edges.map(e => `  - "${e}"`).join('\n')}`;
					
					if (frontmatter.match(/^edges\s*:/m)) {
						// Replace existing edges array (handle both inline and multiline formats)
						// Match: edges: ... followed by optional multiline items
						frontmatter = frontmatter.replace(/^edges\s*:.*?(?=\n\w|\n---|$)/ms, edgesYaml);
					} else {
						frontmatter += `\n${edgesYaml}`;
					}
				} else {
					// Remove edges property if empty
					if (frontmatter.match(/^edges\s*:/m)) {
						// Remove edges line and any following array items
						frontmatter = frontmatter.replace(/^edges\s*:.*?(?=\n\w|\n---|$)/ms, '');
					}
				}

				content = content.replace(frontmatterRegex, `---\n${frontmatter}\n---\n`);
			} else {
				// Add new frontmatter with edges if any
				if (edges.length > 0) {
					const edgesYaml = edges.length === 1 
						? `edges: ["${edges[0]}"]`
						: `edges:\n${edges.map(e => `  - "${e}"`).join('\n')}`;
					const frontmatter = `---\n${edgesYaml}\n---\n\n`;
					content = frontmatter + content;
				}
			}

			await this.app.vault.modify(file, content);
		} catch (error) {
			console.error('Error saving edges:', error);
		}
	}

	private async saveNodePosition(node: CanvasNode): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(node.path) as TFile;
		if (!file) return;

		try {
			let content = await this.app.vault.read(file);
			const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n/;
			const match = content.match(frontmatterRegex);

			if (match) {
				// Update existing frontmatter
				let frontmatter = match[1];
				
				// Update or add node_x
				if (frontmatter.match(/^node_x\s*:/m)) {
					frontmatter = frontmatter.replace(/^node_x\s*:.*$/m, `node_x: ${Math.round(node.x)}`);
				} else {
					frontmatter += `\nnode_x: ${Math.round(node.x)}`;
				}
				
				// Update or add node_y
				if (frontmatter.match(/^node_y\s*:/m)) {
					frontmatter = frontmatter.replace(/^node_y\s*:.*$/m, `node_y: ${Math.round(node.y)}`);
				} else {
					frontmatter += `\nnode_y: ${Math.round(node.y)}`;
				}

				content = content.replace(frontmatterRegex, `---\n${frontmatter}\n---\n`);
			} else {
				// Add new frontmatter
				const frontmatter = `---\nnode_x: ${Math.round(node.x)}\nnode_y: ${Math.round(node.y)}\n---\n\n`;
				content = frontmatter + content;
			}

			await this.app.vault.modify(file, content);
		} catch (error) {
			console.error('Error saving node position:', error);
		}
	}

	private render(): void {
		if (!this.ctx) {
			return;
		}

		// Clear canvas
		this.ctx.clearRect(0, 0, this.canvas.width / window.devicePixelRatio, this.canvas.height / window.devicePixelRatio);

		// Draw grid
		this.drawGrid();

		// Draw links between nodes (if they reference each other)
		this.drawLinks();

		// Draw nodes
		for (const node of this.nodes.values()) {
			this.drawNode(node);
		}
	}

	private drawGrid(): void {
		const width = this.canvas.width / window.devicePixelRatio;
		const height = this.canvas.height / window.devicePixelRatio;
		
		this.ctx.strokeStyle = 'rgba(100, 100, 100, 0.1)';
		this.ctx.lineWidth = 1;

		const gridSize = 50 * this.zoom;
		const startX = (-this.panOffset.x * this.zoom) % gridSize;
		const startY = (-this.panOffset.y * this.zoom) % gridSize;

		// Vertical lines
		for (let x = startX; x < width; x += gridSize) {
			this.ctx.beginPath();
			this.ctx.moveTo(x, 0);
			this.ctx.lineTo(x, height);
			this.ctx.stroke();
		}

		// Horizontal lines
		for (let y = startY; y < height; y += gridSize) {
			this.ctx.beginPath();
			this.ctx.moveTo(0, y);
			this.ctx.lineTo(width, y);
			this.ctx.stroke();
		}
	}

	private getEdgeKey(source: string, target: string): string {
		// Use consistent ordering to avoid duplicate edges
		return source < target ? `${source}|${target}` : `${target}|${source}`;
	}

	private drawLinks(): void {
		// Draw edges from frontmatter
		this.ctx.strokeStyle = 'rgba(150, 150, 150, 0.3)';
		this.ctx.lineWidth = 1;

		for (const edge of this.edges.values()) {
			const sourceNode = this.nodes.get(edge.source);
			const targetNode = this.nodes.get(edge.target);
			
			if (!sourceNode || !targetNode) continue;

			const isHovered = this.hoveredEdge === edge;
			
			if (isHovered) {
				this.ctx.strokeStyle = 'rgba(255, 100, 100, 0.6)';
				this.ctx.lineWidth = 2;
			} else {
				this.ctx.strokeStyle = 'rgba(150, 150, 150, 0.3)';
				this.ctx.lineWidth = 1;
			}

			const start = this.worldToScreen(sourceNode.x, sourceNode.y);
			const end = this.worldToScreen(targetNode.x, targetNode.y);
			
			this.ctx.beginPath();
			this.ctx.moveTo(start.x, start.y);
			this.ctx.lineTo(end.x, end.y);
			this.ctx.stroke();
		}

		// Draw preview edge when creating new edge
		if (this.edgeSourceNode) {
			const start = this.worldToScreen(this.edgeSourceNode.x, this.edgeSourceNode.y);
			this.ctx.strokeStyle = 'rgba(100, 150, 255, 0.5)';
			this.ctx.lineWidth = 2;
			this.ctx.setLineDash([5, 5]);
			this.ctx.beginPath();
			this.ctx.moveTo(start.x, start.y);
			// Get current mouse position from canvas
			const rect = this.canvas.getBoundingClientRect();
			const mouseX = this.lastPanPoint.x;
			const mouseY = this.lastPanPoint.y;
			this.ctx.lineTo(mouseX, mouseY);
			this.ctx.stroke();
			this.ctx.setLineDash([]);
		}
	}

	private drawNode(node: CanvasNode): void {
		const screenPos = this.worldToScreen(node.x, node.y);
		const isSelected = this.selectedNode === node;

		// Draw circle
		this.ctx.beginPath();
		this.ctx.arc(screenPos.x, screenPos.y, node.size / 2, 0, Math.PI * 2);
		
		if (isSelected) {
			this.ctx.fillStyle = 'rgba(100, 150, 255, 0.8)';
			this.ctx.strokeStyle = 'rgba(100, 150, 255, 1)';
			this.ctx.lineWidth = 3;
		} else {
			this.ctx.fillStyle = 'rgba(150, 150, 150, 0.6)';
			this.ctx.strokeStyle = 'rgba(150, 150, 150, 0.8)';
			this.ctx.lineWidth = 2;
		}
		
		this.ctx.fill();
		this.ctx.stroke();

		// Draw label
		this.ctx.fillStyle = 'rgba(200, 200, 200, 0.9)';
		this.ctx.font = `${12}px sans-serif`;
		this.ctx.textAlign = 'center';
		this.ctx.textBaseline = 'top';
		this.ctx.fillText(node.label, screenPos.x, screenPos.y + node.size / 2 + 5);
	}
}
