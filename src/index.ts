// NOTE: package.json must include `"type": "module",` for type hints to work correctly!

import { extractIssueNumbers, GitHub, GitHubLink, GitHubLinkType } from "./github.js";
import { MatrixClient, SimpleFsStorageProvider, MatrixAuth, RustSdkCryptoStorageProvider } from "matrix-bot-sdk";

const homeServerUrl = "https://matrix.org";
const accessToken = process.env.ACCESS_TOKEN!;
const githubAccessToken = process.env.GITHUB_ACCESS_TOKEN!;
const githubRepo = "fish-shell";
const githubRepoOwner = "fish-shell";
const messageType: "html" | "text" = "html";

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

    const github = new GitHub(githubAccessToken, githubRepoOwner, githubRepo);
    const bot = new MatrixBot(client, github);

    await client.start();
    console.log("Matrix client started");
}

class MatrixBot {
    github: GitHub;
    client: MatrixClient;

    public constructor(client: MatrixClient, github: GitHub) {
        this.client = client;
        this.github = github;

        client.on("room.message", async (roomId, event) => {
            await this.messageHandler(roomId, event);
        });
    }

    async messageHandler(roomId: string, event: any) {
        if (!event["content"]) {
            return;
        }

        const sender = event["sender"];
        const body = event["content"]["body"];

        // Make sure we don't recursively process our own replies!
        if (sender === await this.client.getUserId()) {
            return;
        }

        const issueNumbers = extractIssueNumbers(body);
        if (!issueNumbers || issueNumbers.length == 0) {
            return;
        }

        console.debug(`Message received from ${sender}: `, body);
        console.debug("Issue numbers found: ", issueNumbers);

        const githubLinks: GitHubLink[] = [];
        for (const number of issueNumbers) {
            const linkResult = await this.github.mapGitHubIssue(number);
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

        const client = this.client;
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
}


await main();
