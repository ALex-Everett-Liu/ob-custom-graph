export interface ObsidianNode {
	id: string;
	weight: number;
	x?: number;
	y?: number;
	fx?: number | null;
	fy?: number | null;
}

export interface ObsidianRenderer {
	nodes: ObsidianNode[];
	force?: {
		alpha?: () => number;
		alphaTarget?: (value: number) => ObsidianForce;
		restart?: () => void;
	};
}

export interface ObsidianForce {
	alpha: () => number;
	alphaTarget: (value: number) => ObsidianForce;
	restart: () => void;
}

export interface ObsidianView {
	renderer: ObsidianRenderer;
}
