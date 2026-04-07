import { RasterInfo } from "./interfaces";

export async function fetchRasterInfo(perijove: number, band: string): Promise<RasterInfo> {
  const res = await fetch(`/raster/info?perijove=${perijove}&band=${band}`);
  if (!res.ok)
    throw new Error(`Failed to load raster info: HTTP ${res.status}`);
  return res.json();
}

// export async function get_subject_info(subject_id: number): Promise<Subjects> {
//   return await fetch(`https://www.zooniverse.org/api/subjects/${subject_id}`, {
//     method: "GET",
//     headers: {
//       "Content-Type": "application/json",
//       Accept: "application/vnd.api+json; version=1",
//     },
//   }).then((data) => data.json());
// }
//
// export async function get_subjects_from_workflow(
//   workflow_id: number,
//   page?: number,
// ): Promise<number[]> {
//   if (!page) page = 0;
//
//   return await fetch(
//     `https://www.zooniverse.org/api/subjects?workflow_id=${workflow_id}&page=${page}`,
//     {
//       method: "GET",
//       headers: {
//         "Content-Type": "application/json",
//         Accept: "application/vnd.api+json; version=1",
//       },
//     },
//   )
//     .then((resp) => resp.json())
//     .then((data) =>
//       data.subjects.map((subject: SubjectInfo) => subject.id),
//     );
// }
//
// // Set VITE_API_URL in .env to override
// const API_URL = import.meta.env.VITE_API_URL ?? "/api/points";
//
// export async function sendPoints(points: MapPoint[]): Promise<void> {
//   const res = await fetch(API_URL, {
//     method: "POST",
//     headers: { "Content-Type": "application/json" },
//     body: JSON.stringify({
//       points: points.map((p) => ({
//         latitude: p.lat,
//         longitude: p.lng,
//         uv_photon_count: p.value,
//       })),
//     }),
//   });
//   if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
// }
