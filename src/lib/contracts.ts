import { z } from 'zod';
export const CONTRACT_VERSION = 2;
export const fields = ['name','firstName','lastName','phone','email','sourceId','agency','agencyName','birthDate','gender','remark','tripCode','tripName','departureDate'] as const;
export type Field = typeof fields[number];
export const Mapping = z.object({ version:z.union([z.literal(1),z.literal(2)]), sheet:z.number().int().min(0), headerRow:z.number().int().min(0), columns:z.record(z.string().regex(/^\d+$/),z.enum(fields)) });
export type Mapping = z.infer<typeof Mapping>;
export const NormalizedRow = z.object({ name:z.string().min(1).max(300),phone:z.string().nullable(),email:z.string().nullable(),sourceId:z.string().nullable(),agency:z.string().nullable(),agencyName:z.string().nullable(),birthDate:z.string().nullable(),gender:z.enum(['male','female','other']).nullable(),remark:z.string().nullable(),tripCode:z.string().nullable(),tripName:z.string().nullable(),departureDate:z.string().nullable() });
export type NormalizedRow = z.infer<typeof NormalizedRow>;
export const RowIssue = z.object({field:z.string(),message:z.string()});
export type RowIssue = z.infer<typeof RowIssue>;
export const TimelineEvent = z.object({version:z.union([z.literal(1),z.literal(2)]),kind:z.enum(['imported','trip_participation','note','line_message','line_follow','line_unfollow','line_postback']),businessDate:z.string().nullable(),payload:z.record(z.string(),z.unknown())});
export type Actor = {id:string;tenantId:string;username:string};
export class AppError extends Error { constructor(public status:number,message:string) {super(message);} }
