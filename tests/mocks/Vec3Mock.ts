/**
 * Minimal Vec3 mock for testing without vec3 dependency.
 * Implements the subset of Vec3 used by the planning system.
 */
export class Vec3Mock {
  constructor(
    public x: number,
    public y: number,
    public z: number
  ) {}

  clone(): Vec3Mock {
    return new Vec3Mock(this.x, this.y, this.z);
  }

  equals(other: Vec3Mock): boolean {
    return this.x === other.x && this.y === other.y && this.z === other.z;
  }

  distanceTo(other: Vec3Mock): number {
    const dx = this.x - other.x;
    const dy = this.y - other.y;
    const dz = this.z - other.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  offset(dx: number, dy: number, dz: number): Vec3Mock {
    return new Vec3Mock(this.x + dx, this.y + dy, this.z + dz);
  }

  toString(): string {
    return `(${this.x}, ${this.y}, ${this.z})`;
  }
}

export function vec3(x: number, y: number, z: number): Vec3Mock {
  return new Vec3Mock(x, y, z);
}
