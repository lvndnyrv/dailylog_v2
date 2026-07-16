import type { Database } from './types.gen';

export type { Database, Json } from './types.gen';

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert'];

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update'];

export type Daycare = Tables<'daycares'>;
export type Classroom = Tables<'classrooms'>;
export type Profile = Tables<'profiles'>;
export type Child = Tables<'children'>;
