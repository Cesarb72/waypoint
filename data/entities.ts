import { Entity } from "@/types/entity";

export const ENTITIES: Entity[] = [
  {
    id: "1",
    title: "Neighborhood Dinner",
    category: "Food",
    location: "Downtown",
    cost: "$$",
    timeLabel: "Tonight",
    tags: ["Friends", "Casual"],
  },
  {
    id: "2",
    title: "Live Jazz Night",
    category: "Music",
    location: "Midtown",
    cost: "$$$",
    timeLabel: "Friday",
    tags: ["Date Night", "Indoor"],
  },
  {
    id: "3",
    title: "Sunset Hike",
    category: "Outdoors",
    location: "North Ridge Park",
    cost: "Free",
    timeLabel: "This weekend",
    tags: ["Outdoors", "Active"],
  },
  {
    id: "4",
    title: "Board Game Meetup",
    category: "Social",
    location: "Local Café",
    cost: "$",
    timeLabel: "Saturday",
    tags: ["Group", "Indoor"],
  },
  {
    id: "5",
    title: "Farmers Market Visit",
    category: "Local",
    location: "City Square",
    cost: "Free",
    timeLabel: "Sunday Morning",
    tags: ["Daytime", "Food", "Stroll"],
  },
];
