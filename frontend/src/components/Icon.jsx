const paths = {
  calendar: "M4 5h16v16H4V5M8 3v4M16 3v4M4 10h16M8 14h2M14 14h2M8 18h2",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  folder: "M3 5h7l2 3h9v12H3V5",

  shield: "M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4m-4 9 3 3 5-6",
  card: "M3 5h18v14H3V5M3 9h18M6 15h4",
  gift: "M3 8h18v4H3V8M5 12v9h14v-9M12 8v13M12 8C3 8 5 1 9 3l3 5c9 0 7-7 3-5l-3 5",
  check: "m5 12 4 4L20 5",
  compare: "M4 4h6v16H4V4M14 4h6v16h-6V4M7 8h0M17 16h0",
  dice: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01",

  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.9M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
  tools: "m14 6 4 4M3 21l8-8M14 3l-3 3 7 7 3-3M5 3l16 18M3 5l2-2",
  settings:
    "M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2 1-4M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  chat: "M21 11a8 8 0 0 1-8 8H7l-5 3 2-6a8 8 0 1 1 17-5Z",
  trophy:
    "M8 3h8v7a4 4 0 0 1-8 0V3M8 5H4v3a4 4 0 0 0 4 4M16 5h4v3a4 4 0 0 1-4 4M12 14v6M8 21h8",
  play: "m8 4 13 8-13 8V4",

  search: "m21 21-5-5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0",
  cart: "M3 3h2l2.5 12h11L21 7H6M9 20h.01M18 20h.01",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  library: "M4 4h4v16H4zM11 4h4v16h-4zM18 4l3 16",
  user: "M20 21v-2a7 7 0 0 0-14 0v2M17 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
};
export default function Icon({ name, size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.grid} />
    </svg>
  );
}
