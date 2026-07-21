export const profile = {
  name: "Baron Li",
  handle: "whosbaron",
  tagline: "Computer Science at the University at Buffalo. I build the layers most people import: HTTP servers, WebSocket protocols, and audio pipelines, from the socket up.",
  location: "Queens, NY",
  email: "mynameisbaron123@gmail.com",
  phone: "(646) 456-1650",
  github: "https://github.com/modieoldie",
  linkedin: "https://linkedin.com/in/whosbaron",
  instagram: "https://instagram.com/whosbaron",
  resume: "/Li_Baron_resume.pdf",
};

export type Project = {
  title: string;
  period: string;
  blurb: string;
  stack: string[];
  bullets: string[];
  featured?: boolean;
  repo?: string;
  demo?: string;
};

export const projects: Project[] = [
  {
    title: "Web Server & Streaming Platform",
    period: "Jan 2026 — May 2026",
    blurb:
      "A production-shaped HTTP/1.1 server written from raw TCP sockets, with no web framework and no library doing the hard part. It serves a real-time collaborative drawing board and an adaptive-bitrate video platform on top of protocols implemented by hand.",
    stack: ["Python", "Docker", "MongoDB", "WebSockets", "FFmpeg"],
    bullets: [
      "Built a multi-threaded HTTP/1.1 server on Python TCP sockets, including custom parsers that process raw byte streams and multipart form data.",
      "Implemented the WebSocket protocol directly from the RFC, including the SHA-1 upgrade handshake and payload masking, to power a real-time, multi-user drawing board.",
      "Architected an authentication pipeline with bcrypt password hashing, SHA-256 session tokens, and TOTP-based two-factor authentication.",
      "Engineered an Adaptive Bitrate Streaming pipeline with FFmpeg, transcoding MP4 uploads into HLS renditions and capturing thumbnails automatically.",
    ],
    featured: true,
  },
  {
    title: "Karaoke Web Platform",
    period: "Dec 2025",
    blurb:
      "Karaoke in the browser with independently mixable vocal and instrumental tracks, and lyrics that stay locked to the audio. The hard part was sample-accurate sync and per-track gain control in the Web Audio graph.",
    stack: ["React", "Tailwind CSS", "Howler.js", "Web Audio API"],
    bullets: [
      "Developed a responsive app with real-time lyric synchronization and dual-track audio playback.",
      "Engineered a custom audio hook over Howler.js and the Web Audio API, manipulating GainNodes for independent vocal and instrumental volume mixing.",
      "Wrote a RegEx parser for LRC lyric files, rendering an auto-scrolling teleprompter driven by React refs for smooth DOM updates.",
      "Integrated a backend endpoint that ingests YouTube links and processes them into playable karaoke tracks.",
    ],
    featured: true,
    demo: "https://dwerk-baron.vercel.app/", 
  },
  {
    title: "RecipeByte",
    period: "Aug 2025 — Dec 2025",
    blurb:
      "A community recipe-sharing platform built for a software engineering course. Full-stack, with a complete account lifecycle including password reset, which is where most student projects stop short.",
    stack: ["PHP", "MySQL", "JavaScript", "HTML", "CSS", "Apache"],
    bullets: [
      "Engineered a secure full-stack authentication system with registration, login, and an end-to-end password reset workflow in PHP and MySQL.",
      "Built an interactive recipe browser with client-side search and filtering via JavaScript DOM manipulation.",
      "Developed a responsive interface that holds up across desktop and mobile.",
    ],
    featured: true,
  },
  {
    title: "Conway's Game of Life",
    period: "Aug 2024",
    blurb:
      "The classic cellular automaton in C, an exercise in getting multi-dimensional array handling and generation stepping exactly right, with no room to hide behind a garbage collector.",
    stack: ["C"],
    bullets: [
      "Engineered the cell state transition logic to Conway's rules, with careful multi-dimensional array handling and precise output formatting.",
    ],
  },
  {
    title: "Smart Home Automation",
    period: "Jun 2020",
    blurb:
      "A self-hosted home automation system running on a VM, with NFC cards mounted around the house as one-tap physical switches.",
    stack: ["Home Assistant", "Oracle VM", "NFC"],
    bullets: [
      "Integrated smart lights and switches into a centralized Home Assistant system.",
      "Deployed Home Assistant on a virtual machine for scalable management and additional service integrations.",
      "Configured NFC tags as physical cards for one-tap control of individual lights and switches.",
    ],
  },
];

export const experience = [
  {
    role: "Teachers' Assistant",
    org: "Police Athletic League",
    location: "Queens, NY",
    period: "Jun 2021 — Aug 2021",
    bullets: [
      "Reinforced classroom instruction for 30+ students, reviewing lessons and fielding questions one-on-one.",
      "Supervised students outside the classroom during lunch, field trips, and recess.",
    ],
  },
];

export const education = [
  {
    school: "University at Buffalo",
    detail: "School of Engineering and Applied Sciences",
    degree: "B.S. Computer Science",
    location: "Buffalo, NY",
    period: "Aug 2023 — May 2027",
  },
  {
    school: "Queens College, CUNY",
    detail: "One semester before transferring to the University at Buffalo.",
    degree: "Computer Science",
    location: "Queens, NY",
    period: "Fall 2023",
  },
];

export const skills = [
  {
    group: "Languages",
    items: ["Java", "C / C++", "Python", "OCaml", "PHP", "JavaScript", "SQL", "HTML"],
  },
  {
    group: "Frameworks & Development",
    items: ["React", "Tailwind CSS", "Docker", "MongoDB", "MySQL", "WebSockets", "Apache", "Web Audio API"],
  },
  {
    group: "Tools",
    items: ["Git", "Linux / Unix", "Nginx", "FFmpeg", "VS Code", "IntelliJ"],
  },
  {
    group: "Certifications",
    items: ["Google Data Analytics"],
  },
];
