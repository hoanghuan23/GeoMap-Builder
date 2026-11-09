export const LINE_COLORS = Object.freeze(["#ff8354", "#57c785", "#ffd05b", "#5b8ff9", "#9270ca", "#6dc8ec", "#d9548a", "#2f9e9e"]);

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

// Date-only values keep their calendar date; timestamps show local hours too.
export function formatLineX(value, full = false) {
  const text = String(value ?? "");
  const day = ISO_DAY.exec(text);
  if (day && text.includes("T")) {
    const date = new Date(text);
    if (!Number.isNaN(date.getTime())) {
      const pad = part => String(part).padStart(2, "0");
      const dateLabel = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}${full ? `/${date.getFullYear()}` : ""}`;
      return `${dateLabel} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }
  }
  if (day) return full ? `${day[3]}/${day[2]}/${day[1]}` : `${day[3]}/${day[2]}`;
  const month = ISO_MONTH.exec(text);
  if (month) return `${month[2]}/${month[1]}`;
  return text;
}
