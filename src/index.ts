// NOTE: package.json must include `"type": "module",` for type hints to work correctly!

import { Octokit } from "octokit";
import { MatrixClient, SimpleFsStorageProvider, AutojoinRoomsMixin, MatrixAuth, RustSdkCryptoStorageProvider } from "matrix-bot-sdk";

const homeServerUrl = "https://matrix.org";
const accessToken = process.env.ACCESS_TOKEN!;
const githubAccessToken = process.env.GITHUB_ACCESS_TOKEN;
const githubRepo = "fish-shell";
const githubRepoOwner = "fish-shell";
const messageType: "html"|"text" = "html";

async function generateAccessToken(username: string, password: string) {
	const auth = new MatrixAuth(homeServerUrl);
	const client = await auth.passwordLogin(username, password);

	console.log("Copy this access token to your bot's config: ", client.accessToken);
}

async function main() {
	if (!accessToken) {
		if (!!process.env.MATRIX_PASSWORD && !!process.env.MATRIX_USER) {
			generateAccessToken(process.env.MATRIX_USER, process.env.MATRIX_PASSWORD);
			return;
		}
		console.error("ACCESS_TOKEN environment variable is not set!");
	}
	if (!githubAccessToken) {
		console.error("GITHUB_ACCESS_TOKEN environment variable is not set!");
	}

	const storage = new SimpleFsStorageProvider("fish-bot.json");
	const crypto = new RustSdkCryptoStorageProvider("./crypto");
	const client = new MatrixClient(homeServerUrl, accessToken, storage, crypto);

	AutojoinRoomsMixin.setupOnClient(client);

	client.on("room.message", async (roomId, event) => {
		await messageReceived(client, roomId, event);
	});

	await client.start();
	console.log("Matrix client started");
}

async function messageReceived(client: MatrixClient, roomId: string, event: any) {
	if (!event["content"]) {
		return;
	}

	const sender = event["sender"];
	const body = event["content"]["body"];

	// Make sure we don't recursively process our own replies!
    if (sender === await client.getUserId()) {
		return;
	}

	console.trace(`Message received from ${sender}: `, body);
	const issueNumbers = extractIssueNumbers(body);
	if (!issueNumbers || issueNumbers.length == 0) {
		return;
	}

	console.debug("Issue numbers found: ", issueNumbers);
	const githubLinks: GitHubLink[] = [];
	for (const number of issueNumbers) {
		const linkResult = await mapGitHubIssue(number);
		if (linkResult === undefined) {
			continue;
		}

		githubLinks.push(linkResult);
	}

	if (githubLinks.length === 0) {
		// No valid links were found, do nothing.
		return;
	}

	const lines: string[] = [];
	for (const ghLink of githubLinks) {
		let line: string;
		const issueType = (function() {
			if (ghLink.type === GitHubLinkType.Issue) {
				return "Issue";
			} else {
				return "Pull Request";
			}
		})();
		if (messageType === "html") {
			line = `<a href="${ghLink.url}">${issueType} #${ghLink.number}: ${ghLink.emoji} ${ghLink.title}</a>`;
		} else {
			line = `${issueType} ${ghLink.number}: ${ghLink.emoji} ${ghLink.title}: ${ghLink.url}`;
		}
		lines.push(line);
	}

	let result = await (async function() {
		if (messageType === "html") {
			let html: string;
			if (lines.length === 1) {
				html = lines[0];
			} else {
				html = `<ul><li>${lines.join("</li><li>")}</li></ul>`;
			}
			return await client.sendHtmlText(roomId, html);
		} else {
			let text: string;
			if (lines.length === 1) {
				text = lines[0];
			} else {
				text = `* ${lines.join("\n* ")}`;
			}
			return await client.sendText(roomId, text);
		}
	})();

	console.debug("Matrix send result: ", result);
}

function extractIssueNumbers(input: string): number[] {
	const regex = /(?<=(?:\b| |^|\n))#(\d{3,})\b/g;

	// We need to deduplicate the results without changing their order
	const seen = new Set<number>();
	const results: number[] = [];
	let match: RegExpExecArray | null;
	while ((match = regex.exec(input)) !== null) {
		// This is necessary to avoid infinite loops with zero-width matches
		if (match.index === regex.lastIndex) {
			regex.lastIndex++;
		}

		// match[0] is #xyz while match[1] is xyz
		const num = parseInt(match[1]);

		if (seen.has(num)) {
			continue;
		}
		seen.add(num);
		results.push(num);
	}

	return results;
}

enum GitHubLinkType {
	Issue,
	PullRequest,
}

interface GitHubLink {
	type: GitHubLinkType,
	url: URL,
	title: string,
	state: "open" | "closed",
	emoji: string,
	number: number,
}

// NOTE: package.json must include `"type": "module",` for type hints to work correctly!
async function mapGitHubIssue(number: number): Promise<GitHubLink|undefined> {
	if (number <= 0) {
		return undefined;
	}

	const octokit = new Octokit({
		auth: githubAccessToken,
	});

	const issue = await octokit.rest.issues.get({
		owner: githubRepoOwner,
		repo: githubRepo,
		issue_number: number,
	});

	if (issue.status != 200) {
		console.warn(`Unable to retrieve GitHub issue #${number}: `, issue);
		return undefined;
	}

	return {
		number: issue.data.number,
		title: issue.data.title,
		url: new URL(issue.data.html_url),
		type: issue.data.pull_request ? GitHubLinkType.PullRequest : GitHubLinkType.Issue,
		state: <"open" | "closed"> issue.data.state,
		emoji: (function () {
			if (issue.data.pull_request) {
				if (issue.data.state_reason === "completed") {
					return "✅";
				}
				if (issue.data.state_reason === "not_planned") {
					return "🚫";
				}
				return "🛠️";
			}
			if (issue.data.state_reason === "completed") {
				return "☑️";
			}
			if (issue.data.state_reason === "not_planned") {
				return "❌";
			}
			if (issue.data.state === "open") {
				return "⬜";
			}
			if (issue.data.locked) {
				return "🔒";
			}
			return "✅";
		})(),
	};
}

await main();
