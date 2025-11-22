export type Entity = {
    id: string;
    title: string;
    category: string;
    location: string;
    cost?: "Free" | "$" | "$$" | "$$$";
    timeLabel?: string; // e.g. "Tonight", "This weekend"
    tags?: string[];
    imageUrl?: string;
  };
