const firstCharacter = (value: string) => Array.from(value)[0] ?? "";

export const actorInitials = (actorName: string | null, actorEmail: string) => {
  const emailName = actorEmail.split("@")[0].replace(/[._-]+/g, " ");
  const source = actorName?.trim() || emailName.trim();
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const initials = words.length === 1
    ? Array.from(words[0]).slice(0, 2).join("")
    : firstCharacter(words[0]) + firstCharacter(words[words.length - 1]);
  return initials.toLocaleUpperCase("es-CL");
};

export const activitySummaryWithoutActor = (
  summary: string,
  actorName: string | null,
  actorEmail: string
) => {
  const actorLabels = [actorName?.trim(), actorEmail.trim()]
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.length - left.length);
  const actorPrefix = actorLabels.find((label) => summary.startsWith(`${label} `));
  if (!actorPrefix) return summary;
  const remainder = summary.slice(actorPrefix.length).trimStart();
  const [first = "", ...rest] = Array.from(remainder);
  return first.toLocaleUpperCase("es-CL") + rest.join("");
};

export const formatActivityTimestamp = (value: string, now = new Date()) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, "0");
  const dateParts = [
    pad(date.getDate()),
    pad(date.getMonth() + 1),
    ...(date.getFullYear() === now.getFullYear() ? [] : [String(date.getFullYear())]),
  ];
  return `${dateParts.join("-")}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
