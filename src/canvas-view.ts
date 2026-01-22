import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';

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
	private selectedNode: CanvasNode | null = null;
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

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
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
				style: 'width: 100%; height: 100%; display: block; cursor: grab;'
			}
		});
		this.canvas.style.width = '100%';
		this.canvas.style.height = '100%';

		this.ctx = this.canvas.getContext('2d')!;
		
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

		// Initial render
		this.render();
		this.updateInputsFromState();
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
		const rect = this.canvas.getBoundingClientRect();
		this.canvas.width = rect.width * window.devicePixelRatio;
		this.canvas.height = rect.height * window.devicePixelRatio;
		this.ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
	}

	private loadNodes(): void {
		this.nodes.clear();
		
		const files = this.app.vault.getMarkdownFiles();
		
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
			}
		}
	}

	private setupEventListeners(): void {
		// Mouse events
		this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
		this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
		this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
		this.canvas.addEventListener('mouseleave', this.onMouseUp.bind(this));
		this.canvas.addEventListener('dblclick', this.onDoubleClick.bind(this));
		this.canvas.addEventListener('wheel', this.onWheel.bind(this));

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

	private onMouseDown(e: MouseEvent): void {
		const pos = this.getMousePos(e);
		const node = this.getNodeAt(pos.x, pos.y);

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

	private onMouseUp(e: MouseEvent): void {
		if (this.isDragging && this.selectedNode) {
			// Save position to frontmatter
			this.saveNodePosition(this.selectedNode);
			this.selectedNode = null;
			this.isDragging = false;
		}
		
		if (this.isPanning) {
			this.isPanning = false;
		}
		
		this.canvas.style.cursor = 'grab';
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
		if (!this.ctx) return;

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

	private drawLinks(): void {
		const nodesArray = Array.from(this.nodes.values());
		
		this.ctx.strokeStyle = 'rgba(150, 150, 150, 0.3)';
		this.ctx.lineWidth = 1;

		for (const node of nodesArray) {
			const file = this.app.vault.getAbstractFileByPath(node.path) as TFile;
			if (!file) continue;

			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache) continue;

			// Draw links to referenced files
			if (cache.links) {
				for (const link of cache.links) {
					const targetPath = this.app.metadataCache.getFirstLinkpathDest(link.link, file.path)?.path;
					if (targetPath && this.nodes.has(targetPath)) {
						const targetNode = this.nodes.get(targetPath)!;
						const start = this.worldToScreen(node.x, node.y);
						const end = this.worldToScreen(targetNode.x, targetNode.y);
						
						this.ctx.beginPath();
						this.ctx.moveTo(start.x, start.y);
						this.ctx.lineTo(end.x, end.y);
						this.ctx.stroke();
					}
				}
			}
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
