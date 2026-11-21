/**
 * chanfana 2's parameter helpers (Str, Num, Int, Bool, DateTime, Enumeration), which chanfana 3 removed.
 *
 * Same behaviour as chanfana 2.8: `required: false` makes the field optional, `description` describes it,
 * a truthy `default` sets the default, and `example`/`format` go into the OpenAPI document. The declared
 * return types are chanfana 2's too (an optional Str() is still typed as ZodString), so moving to chanfana 3
 * changes neither request validation nor the types handlers see. New code can use plain zod schemas.
 *
 * Importing chanfana first matters: it calls extendZodWithOpenApi(z), which adds `.openapi()`.
 * The same file lives in apps/admin-api and apps/log-service.
 */
import 'chanfana';
import { z } from 'zod';

export interface ParameterType {
	default?: string | number | boolean;
	description?: string;
	example?: string | number | boolean;
	required?: boolean;
	deprecated?: boolean;
	format?: string;
}

export interface EnumerationParameterType extends ParameterType {
	values: Record<string, unknown> | string[];
	enumCaseSensitive?: boolean;
}

function convertParams(field: any, params: ParameterType = {}): any {
	if (params.required === false) field = field.optional();
	if (params.default) field = field.default(params.default);
	// After default(): zod 4 keeps a description on the schema it was set on (zod 3 copied it to the wrapper)
	if (params.description) field = field.describe(params.description);
	if (params.example) field = field.openapi({ example: params.example });
	if (params.format) field = field.openapi({ format: params.format });
	return field;
}

export function Str(params?: ParameterType): z.ZodString {
	return convertParams(z.string(), params);
}

export function Num(params?: ParameterType): z.ZodNumber {
	return convertParams(z.number(), params).openapi({ type: 'number' });
}

export function Int(params?: ParameterType): z.ZodNumber {
	return convertParams(z.number().int(), params).openapi({ type: 'integer' });
}

export function Bool(params?: ParameterType): z.ZodBoolean {
	return convertParams(z.boolean(), params).openapi({ type: 'boolean' });
}

export function DateTime(params?: ParameterType): z.ZodString {
	return convertParams(z.iso.datetime({ error: 'Must be in the following format: YYYY-mm-ddTHH:MM:ssZ' }), params);
}

export function Enumeration(params: EnumerationParameterType): z.ZodEnum<any> {
	let values: Record<string, unknown> = Array.isArray(params.values)
		? Object.fromEntries(params.values.map((x) => [x, x]))
		: params.values;
	const originalValues = Array.isArray(params.values) ? { ...params.values } : { ...params.values };
	const originalKeys = Object.keys(values);
	if (params.enumCaseSensitive === false) {
		values = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
	}
	const keys = Object.keys(values) as [string, ...string[]];
	let field: any =
		params.enumCaseSensitive === false
			? z.preprocess((val) => String(val).toLowerCase(), z.enum(keys)).openapi({ enum: originalKeys })
			: z.enum(keys);
	field = field.transform((val: string) => values[val]);
	const result = convertParams(field, params);
	result.values = originalValues;
	return result;
}
