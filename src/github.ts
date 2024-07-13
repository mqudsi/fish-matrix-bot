// NOTE: package.json must include `"type": "module",` for type hints to work correctly!

import { OctokitResponse } from "@octokit/types";
import { Octokit } from "octokit";

const delay = (millis: number) => new Promise(resolve => setTimeout(resolve, millis));

export enum GitHubLinkType {
    Issue,
    PullRequest,
}

export interface GitHubLink {
    type: GitHubLinkType,
    url: URL,
    title: string,
    state: "open" | "closed",
    emoji: string,
    number: number,
}

export type RepoEventType =
    "IssueCommentEvent" |
    "IssuesEvent" |
    "PullRequestEvent" |
    "PullRequestReviewCommentEvent" |
    "PullRequestReviewEvent" |
    "WatchEvent";

export class GitHub {
    api: Octokit;
    repo: string;
    owner: string;

    public constructor(accessToken: string, owner: string, repo: string) {
        this.api = new Octokit({
            auth: accessToken,
        });
        this.owner = owner;
        this.repo = repo;
    }

    public async mapGitHubIssue(number: number): Promise<GitHubLink | undefined> {
        if (number <= 0) {
            return undefined;
        }

        const issue = await this.api.rest.issues.get({
            owner: this.owner,
            repo: this.repo,
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
            state: <"open" | "closed">issue.data.state,
            emoji: (function() {
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
                    return "☑️️";
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

    // Monitors the target repo and asynchronously yields events of interest.
    public async *watchForEvents(epoch: Date, eventsOfInterest: RepoEventType[]) {
        const watchTypes = new Set<RepoEventType>();
        for (const watch of eventsOfInterest) {
            watchTypes.add(watch);
        }

        let etag: string | undefined = undefined;
        let pollInterval: number = 0;
        while (true) {
            await delay(pollInterval * 1000);
            const events = await (async () => {
                try {
                    let result = await this.api.rest.activity.listRepoEvents({
                        repo: this.repo,
                        owner: this.owner,
                        headers: {
                            "if-none-match": etag,
                        },
                    });
                    etag = result.headers.etag;
                    return result;
                } catch (ex: any) {
                    const error = <OctokitResponse<never>>ex;
                    // Ignore errors and just retry later
                    if (error.status !== 304) {
                        console.warn("GitHub events error: ", error);
                    }
                    return null;
                }
            })();
            if (!events) {
                // This has already been logged.
                continue;
            }

            if (events.headers["x-poll-interval"]) {
                pollInterval = parseInt(events.headers["x-poll-interval"].toString());
            } else {
                pollInterval = 60;
            }

            let handled = 0;
            for (const event of events.data) {
                if (new Date(event.created_at!) < epoch) {
                    // Presume event has already been handled/reported
                    continue;
                }
                handled += 1;
                if (!watchTypes.has(<RepoEventType>event.type)) {
                    console.debug(`Ignoring ${event.type} event ${event.id}`);
                    continue;
                }

                yield event;
            }

            console.debug(`Handled ${handled} new repo event(s)`);
        }
    }
}

export function extractIssueNumbers(input: string): number[] {
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
