export type Transition = "cut" | "fade" | "slide_in" | "zoom_in" | "flash" | "hold";
export type Action = "show" | "hold";

export interface VisualFeatures {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  sharpness: number;
  energy: number;
}

export interface MediaItem {
  id: string;
  type: "image" | "video";
  path: string;
  duration: number | null;
  features: VisualFeatures;
}

export interface TimelineEvent {
  t: number;
  beat_index?: number;
  energy?: number;
  action: Action;
  media_id: string;
  transition: Transition;
  duration: number;
  src_in?: number;
  src_out?: number;
  reason?: string;
}

export interface Script {
  version: 1;
  audio: {
    path: string;
    duration: number;
    sample_rate?: number;
    bpm_estimate?: number | null;
    beat_count?: number;
  };
  config: {
    every_n_beats: number;
    default_transition?: string;
    min_event_gap?: number;
    zoom_max?: number;
    fade_in_max?: number;
    fade_in_frac?: number;
  };
  media: Record<string, MediaItem>;
  timeline: TimelineEvent[];
}
