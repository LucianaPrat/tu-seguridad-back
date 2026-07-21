export interface Coordinate {
  x: number;
  y: number;
}

export interface BoundingBox {
  topLeft: Coordinate;
  bottomRight: Coordinate;
}

export interface PersonDetection {
  detScore: number;
  bbox: BoundingBox;
  bboxNorm: BoundingBox;
  anchor: Coordinate;
}

export interface DetectPersonsResponse {
  personsDetected: boolean;
  imageWidth: number;
  imageHeight: number;
  persons: PersonDetection[];
}
