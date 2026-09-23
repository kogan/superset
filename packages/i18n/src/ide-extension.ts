import { setupI18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { getLocaleMessages, SUPPORTED_LOCALES } from "./index";

export async function getIdeExtensionTranslations() {
	const descriptors = {
		"Branch Changes": msg({ message: "Branch Changes" }),
		Refresh: msg({ message: "Refresh" }),
		"Open Changes": msg({ message: "Open Changes" }),
		"Open File": msg({ message: "Open File" }),
		Modified: msg({ message: "Modified" }),
		Added: msg({ message: "Added" }),
		Deleted: msg({ message: "Deleted" }),
		Renamed: msg({ message: "Renamed" }),
		Copied: msg({ message: "Copied" }),
		Conflicting: msg({ message: "Conflicting" }),
		"No changes": msg({ message: "No changes" }),
		"Unable to load branch changes. Check the Superset Branch Changes output.":
			msg({
				message:
					"Unable to load branch changes. Check the Superset Branch Changes output.",
			}),
		"Unable to open changes. Refresh the branch changes list and try again.":
			msg({
				message:
					"Unable to open changes. Refresh the branch changes list and try again.",
			}),
	};
	return Promise.all(
		SUPPORTED_LOCALES.map(async (locale) => {
			const messages = await getLocaleMessages(locale);
			const translator = setupI18n({
				locale,
				messages: { [locale]: messages },
			});
			return {
				locale,
				messages: Object.fromEntries(
					Object.entries(descriptors).map(([key, descriptor]) => [
						key,
						translator._(descriptor),
					]),
				),
			};
		}),
	);
}
