import { Request, Response } from "express";
import { Endpoint, S3 } from "aws-sdk";
import { wrap } from "./wrap";

export default function upload(
  handler: (
    req: Request,
    res: Response,
    getSignedRequest: (args: {
      fileName: string;
      fileType: string;
    }) => Promise<string>
  ) => Promise<any>,
  {
    endpointUrl,
    S3_BUCKET = process.env.S3_BUCKET,
    AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "",
    AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "",
  }: {
    endpointUrl: string;
    S3_BUCKET?: string;
    AWS_ACCESS_KEY_ID?: string;
    AWS_SECRET_ACCESS_KEY?: string;
  }
) {
  return wrap(async (req, res) => {
    const getSignedRequest = async ({
      fileName,
      fileType,
    }: {
      fileName: string;
      fileType: string;
    }) => {
      const endpoint = new Endpoint(endpointUrl);

      const s3 = new S3({
        endpoint: endpoint,
        accessKeyId: AWS_ACCESS_KEY_ID,
        secretAccessKey: AWS_SECRET_ACCESS_KEY,
      });

      const s3Params = {
        Bucket: S3_BUCKET,
        Key: fileName,
        Expires: 60,
        ContentType: fileType,
        ACL: "public-read",
      };

      const getSignedUrl = (name: string, params: any) =>
        new Promise((resolve, reject) => {
          s3.getSignedUrl(name, params, (err, data) => {
            if (err) return reject(err);
            resolve(data);
          });
        });

      const signedUrl = (await getSignedUrl("putObject", s3Params)) as string;

      return signedUrl;
    };

    const data = await handler(req, res, getSignedRequest);

    return data;
  });
}
