import * as Core from 'openai/core';
import { APIResource } from 'openai/resource';
import * as API from './index.js';
import { type Uploadable } from 'openai/core';
import { Page } from 'openai/pagination';
export declare class Files extends APIResource {
  /**
   * Upload a file that contains document(s) to be used across various
   * endpoints/features. Currently, the size of all the files uploaded by one
   * organization can be up to 1 GB. Please contact us if you need to increase the
   * storage limit.
   */
  create(body: FileCreateParams, options?: Core.RequestOptions): Core.APIPromise<FileObject>;
  /**
   * Returns information about a specific file.
   */
  retrieve(fileId: string, options?: Core.RequestOptions): Core.APIPromise<FileObject>;
  /**
   * Returns a list of files that belong to the user's organization.
   */
  list(options?: Core.RequestOptions): Core.PagePromise<FileObjectsPage, FileObject>;
  /**
   * Delete a file.
   */
  del(fileId: string, options?: Core.RequestOptions): Core.APIPromise<FileDeleted>;
  /**
   * Returns the contents of the specified file
   */
  retrieveContent(fileId: string, options?: Core.RequestOptions): Core.APIPromise<string>;
}
/**
 * Note: no pagination actually occurs yet, this is for forwards-compatibility.
 */
export declare class FileObjectsPage extends Page<FileObject> {}
type _FileObjectsPage = FileObjectsPage;
export type FileContent = string;
export interface FileDeleted {
  id: string;
  deleted: boolean;
  object: string;
}
/**
 * The `File` object represents a document that has been uploaded to OpenAI.
 */
export interface FileObject {
  /**
   * The file identifier, which can be referenced in the API endpoints.
   */
  id: string;
  /**
   * The size of the file in bytes.
   */
  bytes: number;
  /**
   * The unix timestamp for when the file was created.
   */
  created_at: number;
  /**
   * The name of the file.
   */
  filename: string;
  /**
   * The object type, which is always "file".
   */
  object: string;
  /**
   * The intended purpose of the file. Currently, only "fine-tune" is supported.
   */
  purpose: string;
  /**
   * The current status of the file, which can be either `uploaded`, `processed`,
   * `pending`, `error`, `deleting` or `deleted`.
   */
  status?: string;
  /**
   * Additional details about the status of the file. If the file is in the `error`
   * state, this will include a message describing the error.
   */
  status_details?: string | null;
}
export interface FileCreateParams {
  /**
   * Name of the [JSON Lines](https://jsonlines.readthedocs.io/en/latest/) file to be
   * uploaded.
   *
   * If the `purpose` is set to "fine-tune", each line is a JSON record with "prompt"
   * and "completion" fields representing your
   * [training examples](/docs/guides/fine-tuning/prepare-training-data).
   */
  file: Uploadable;
  /**
   * The intended purpose of the uploaded documents.
   *
   * Use "fine-tune" for [Fine-tuning](/docs/api-reference/fine-tunes). This allows
   * us to validate the format of the uploaded file.
   */
  purpose: string;
}
export declare namespace Files {
  export import FileContent = API.FileContent;
  export import FileDeleted = API.FileDeleted;
  export import FileObject = API.FileObject;
  type FileObjectsPage = _FileObjectsPage;
  export import FileCreateParams = API.FileCreateParams;
}
export {};
//# sourceMappingURL=files.d.ts.map
