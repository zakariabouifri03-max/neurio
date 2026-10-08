export interface DesignRequest {
  prompt: string;
  style: string;
  palette: string;
  aspect: string;
  background: 'solid' | 'gradient' | 'transparent' | 'image';
  typography: string;
  complexity: 'minimal' | 'balanced' | 'rich';
}

export type BlueprintElement =
  | {
      type: 'text';
      id: string;
      text: string;
      x: number;
      y: number;
      width: number;
      fontSize: number;
      fontFamily: string;
      fontWeight: 'normal' | 'bold';
      fill: string;
      align: 'left' | 'center' | 'right';
      role: 'headline' | 'subhead' | 'body' | 'caption';
    }
  | {
      type: 'rect' | 'ellipse' | 'triangle' | 'star';
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      opacity?: number;
      rx?: number;
      angle?: number;
    }
  | {
      type: 'image';
      id: string;
      prompt: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };

export interface DesignBlueprint {
  title: string;
  width: number;
  height: number;
  background: string;
  palette: string[];
  elements: BlueprintElement[];
}
