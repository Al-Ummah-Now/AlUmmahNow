/**
 * Theme-demo content seeded on QA for the theme prototypes (branch
 * proto/theme-demos-content, apps/web/demo-content/demo-set.json at 3bf3e6cf).
 * The QA cleanup never deletes any of it: 7 demo-<key>@delivered.resend.dev
 * accounts, their channels (Masajid of the World, Call and Recitation, Lanes and Markets, Desert Trails, Waters and Forests, Signs in the Sky, Craft and Harvest),
 * 47 videos (incl. 443418c1 and the deliberately unplayable "Lantern Makers of
 * Old Cairo", which stays in "processing" on purpose) and 4 playlists.
 *
 * Vendored here because that branch is not merged; once demo-set.json is on main,
 * the unit test checks the two lists still match.
 */
export const THEME_DEMO_ACCOUNT_KEYS: readonly string[] = ['masajid', 'nidaa', 'aswaq', 'sahra', 'miyah', 'sama', 'sunaa'];

export const THEME_DEMO = {
	channelIds: new Set<string>([
		'ffb90e22-64dd-49da-a5d9-ac8bb2a8faf7',
		'809df522-b581-4732-a188-29df5c01c800',
		'f15d9577-73fd-4291-8434-ff9677e69099',
		'dfa901b5-f1aa-4e42-a410-78b7021f52a4',
		'b3ca54f5-81a6-4832-bb6c-613b2ff92564',
		'82746465-e2cc-40e3-a12e-5fb888b1649b',
		'147c6823-d7e2-474e-aa34-3c1e01a9ba5a',
	]),
	videoIds: new Set<string>([
		'011820ec-b4f2-4fdf-a166-5009b69186cd',
		'0621f8fb-dac7-45fc-80a7-126bdfec88a8',
		'06928804-0d23-4ed0-b0f6-c814817835fa',
		'0f5f0e14-1632-457a-97ca-9961627047a1',
		'16a7ddc4-73db-4ce9-803e-5536eb6896a6',
		'17ff9f7f-ef03-4b64-8ce7-b831057e0fa6',
		'1a80e6b8-7688-4aff-ad30-73600ba83495',
		'25f951d7-2662-4290-8246-0cdb0dfd4b55',
		'2d1e5ccb-19f6-46ab-9ff6-0ae24656d3ea',
		'332be19b-06ec-4a1c-83bc-c18cf6007f24',
		'3c134de9-428c-43c4-b100-b7d054c40c59',
		'3e3e59fc-68a0-4147-92d6-2a783a2ee2bd',
		'443418c1-dc70-43d9-944d-5388ab7dc4c3',
		'535525b8-82d1-4599-96c6-c1771bf40e63',
		'556a27f2-b621-490a-91b4-0595966e67b3',
		'55b48a5a-4a9e-4a3f-b40f-0d6804d2935a',
		'592c2188-b1a5-47ce-abb4-3fb5c1e79525',
		'59b883bd-34fd-4454-83c3-6698ad5f0c5a',
		'63cd09b1-6237-4f19-bd8a-2c61713b4154',
		'64e552a3-a6c2-49aa-8f0c-9cf18e5ba95b',
		'65157aed-5466-4b34-8cab-adc82f423843',
		'69fa329f-dc6b-47f2-bd5f-dd64828a1f12',
		'718dd9c8-480e-475e-aef6-eca6412fa68b',
		'8161cfa1-aaf5-476b-a53c-04bee4b4b22f',
		'877d8cf7-dcc7-45f1-8725-450bbf9e3fa2',
		'939f86e8-6466-49f5-a680-5737f7d67a1a',
		'a3ebd464-718f-4069-a91d-c2f46a94f180',
		'a457970a-aa06-47c5-b099-6251d3fa7a55',
		'b32b365a-dda4-4586-9819-754cb0a30f73',
		'b85181ed-3583-4831-b8bd-7f0de0e47214',
		'b9ecc98b-d893-4f6b-a7c1-31107fd5e1b6',
		'b9ed4e16-f2b6-4176-8b02-f13b12163474',
		'bb0455d4-1606-4f29-8cd4-0810fa1496c6',
		'bd060f90-51b0-46f8-b5d0-ef21aeb0fd9d',
		'bf05522a-862c-4dea-b951-539ce04316ea',
		'cae82a82-d0f8-472b-ade0-c12f6a1ae814',
		'ddbc8117-b96d-46d9-be1e-55fd8477f847',
		'def16ed2-fba7-4965-8be5-ce697106c45d',
		'e1d6a8d0-5f13-48b2-b1c7-860a23988c4b',
		'e42e5deb-c86a-40b0-b8ec-6072fc550dba',
		'e7a93805-cae4-47bc-91c7-3d644ef27e19',
		'ef1b0da3-3f50-43f4-b926-1dd9109c9729',
		'f8e1a04f-7563-43ed-8d5e-b2ee93d946cf',
		'f8f45625-bb18-4a6d-8972-b1af81487def',
		'f941d911-27ec-431c-b92e-4e6101a8e61c',
		'fa6c26e2-241a-460a-b756-724073fa0bdc',
		'fb935eb8-b169-4a52-9554-56335232a354',
	]),
	playlistIds: new Set<string>([
		'86b238d1-f01e-411f-aa30-cd3ba77b118c',
		'4b7f01df-2d52-4dc1-92b4-21aee04b94ed',
		'4403571a-b065-437b-83d3-295c782f3c87',
		'0939cc1c-9637-4d81-9227-39596a74998f',
	]),
} as const;
