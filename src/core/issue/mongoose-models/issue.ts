import mongoose from 'mongoose';
import { InternalIssue } from '../internal-models/issue';

export interface InternalIssueDoc extends InternalIssue, mongoose.Document {}
export const TTL_IN_SECOND = 365 * 24 * 3600;

const IssueSchemaDef: mongoose.Schema = new mongoose.Schema(
  {
    issueId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
    },
    severity: {
      type: Number,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    deduplicationToken: {
      type: String,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

IssueSchemaDef.index({ updatedAt: 1 }, { expireAfterSeconds: TTL_IN_SECOND });
IssueSchemaDef.index({ status: 1, updatedAt: 1 }); // list operation index
IssueSchemaDef.index({ status: 1, deduplicationToken: 1 }); // deduplication operation index

export default mongoose.model<InternalIssueDoc>('issuev2', IssueSchemaDef);
