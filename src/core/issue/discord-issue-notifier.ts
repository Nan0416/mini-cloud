import { LoggerFactory } from '@ultrasa/dev-kit';
import Discord, { EmbedBuilder } from 'discord.js';
import { IssueNotifier } from './issue-notifier';
import { Issue, IssueStatus } from '@ultrasa/mini-cloud-models';

const logger = LoggerFactory.getLogger('IssueNotifierImpl');

// Map severity to some emoji or color for better visibility
const SERVERITY_TO_COLOR: Record<number, number> = {
  1: 0x00ff00, // Green
  2: 0xffff00, // Yellow
  3: 0xffa500, // Orange
  4: 0xff4500, // Red-Orange
  5: 0xff0000, // Red
};

export class DiscordIssueNotifier implements IssueNotifier {
  private readonly discordWebhookClient: Discord.WebhookClient;

  constructor(discordWebhookClient: Discord.WebhookClient) {
    this.discordWebhookClient = discordWebhookClient;
  }

  async newIssue(issue: Issue): Promise<void> {
    logger.info(`Notify new issue [SEV-${issue.severity}] ISSUE/${issue.issueId} ${issue.title} (${issue.status}).`);
    logger.info('Send notification through discord.');

    const issueEmbed = new EmbedBuilder()
      .setTitle(`[${issue.status.toUpperCase()}] ${issue.title}`)
      .setDescription(issue.description)
      .addFields(
        { name: 'Issue ID', value: issue.issueId, inline: true },
        { name: 'Category', value: issue.category, inline: true },
        { name: 'Type', value: issue.type, inline: true },
        { name: 'Severity', value: issue.severity.toString(), inline: true },
        {
          name: 'Created At',
          value: new Date(issue.createdAt).toLocaleString(),
          inline: true,
        },
        {
          name: 'Last Updated',
          value: new Date(issue.lastUpdatedAt).toLocaleString(),
          inline: true,
        },
      )
      .setColor(SERVERITY_TO_COLOR[issue.severity] || 0x0099ff)
      .setTimestamp();

    this.discordWebhookClient.send({ embeds: [issueEmbed] });
  }

  async statusChange(issueId: string, status: IssueStatus): Promise<void> {
    // ignore sending status change notification because only I work on the project.
  }
}
