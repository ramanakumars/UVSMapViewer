export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  value: number | null;
}

export interface RasterInfo {
  width: number;
  height: number;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  pixel_width: number;
  pixel_height: number;
  proj4str: string;
  crs_code: string;
  min_val: number;
  max_val: number;
  resolutions: number[];
}

export interface SubjectInfo {
  id: number;
  metadata: {
    pole: string;
    perijove: string;
  };
  locations: [];
}

export interface Subjects {
  subjects: SubjectInfo[];
}

export interface UserInfo {
  login: string;
  display_name: string;
}
