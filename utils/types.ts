export interface Token {
  property: string;
  name: string;
  value: string;
  inherited?: boolean;
}

export interface Hardcoded {
  property: string;
  value: string;
}

export interface DetectedElement {
  id: string;
  tagName: string;
  className: string;
  type: 'used' | 'unused';
  tokens?: Token[];
  hardcoded?: Hardcoded[];
  isVisible?: boolean;
  frameId?: string;
  selector?: string;
}
