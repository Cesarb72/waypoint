export type OriginType = 'search' | 'browse' | 'create' | 'shared' | 'recent';

export interface Origin {
  type: OriginType;
  label: string;
  source?: string;
  createdAt: number;
  sessionId: string;
}
