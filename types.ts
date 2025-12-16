
export interface Message {
  id: string;
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  isThinking?: boolean;
  groundingMetadata?: GroundingMetadata;
  isSystemReport?: boolean;
}

export interface GroundingMetadata {
  groundingChunks?: {
    web?: {
      uri: string;
      title: string;
    };
  }[];
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  isThinkingMode: boolean;
  isTTSEnabled: boolean;
}

export enum AppMode {
  CHAT = 'CHAT',
  LIVE = 'LIVE'
}

export interface AudioConfig {
  sampleRate: number;
  channels: number;
}
