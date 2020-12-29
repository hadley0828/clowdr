import sgMail from "@sendgrid/mail";
import assert from "assert";
import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { is } from "typescript-is";
import { initialiseAwsClient } from "./aws/awsClient";
import handlerEcho from "./handlers/echo";
import { handleEmailCreated } from "./handlers/event";
import {
    invitationConfirmCurrentHandler,
    invitationConfirmSendInitialEmailHandler,
    invitationConfirmSendRepeatEmailHandler,
    invitationConfirmWithCodeHandler,
    invitationSendInitialHandler,
    invitationSendRepeatHandler,
} from "./handlers/invitation";
import protectedEchoHandler from "./handlers/protectedEcho";
import { uploadSendSubmissionRequestsHandler } from "./handlers/upload";
import { checkEventSecret } from "./middlewares/checkEventSecret";
import { checkJwt } from "./middlewares/checkJwt";
import { checkUserScopes } from "./middlewares/checkScopes";
import { router as amazonTranscribeRouter } from "./router/amazonTranscribe";
import { router as broadcastContentItemRouter } from "./router/broadcastContentItem";
import { router as channelsRouter } from "./router/channels";
import { router as companionRouter } from "./router/companion";
import { router as conferencePrepareJobRouter } from "./router/conferencePrepareJob";
import { router as contentItemRouter } from "./router/contentItem";
import { router as elasticTranscoderRouter } from "./router/elasticTranscoder";
import { router as mediaConvertRouter } from "./router/mediaConvert";
import { router as mediaLiveRouter } from "./router/mediaLive";
import { router as openshotRouter } from "./router/openshot";
import { router as videoRenderJobRouter } from "./router/videoRenderJob";
import { router as vonageRouter } from "./router/vonage";
import { EmailData, Payload } from "./types/hasura/event";

type AuthenticatedRequest = Request & { userId: string };

if (process.env.NODE_ENV !== "test") {
    assert(process.env.AUTH0_API_DOMAIN, "AUTH0_API_DOMAIN environment variable not provided.");
    assert(process.env.AUTH0_AUDIENCE, "AUTH0_AUDIENCE environment variable not provided.");
    assert(process.env.AUTH0_ISSUER_DOMAIN, "AUTH0_ISSUER_DOMAIN environment variable not provided.");

    assert(process.env.SENDGRID_API_KEY, "SENDGRID_API_KEY environment variable not provided.");
    assert(process.env.SENDGRID_SENDER, "SENDGRID_SENDER environment variable not provided.");

    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    assert(process.env.FRONTEND_DOMAIN, "FRONTEND_DOMAIN environment variable not provided.");
    process.env.FRONTEND_PROTOCOL =
        process.env.FRONTEND_PROTOCOL || (process.env.FRONTEND_DOMAIN.startsWith("localhost") ? "http" : "https");

    assert(
        process.env.STOP_EMAILS_CONTACT_EMAIL_ADDRESS,
        "STOP_EMAILS_CONTACT_EMAIL_ADDRESS environment variable not provided."
    );
}

assert(
    process.env.EVENT_SECRET,
    "EVENT_SECRET (x-hasura-event-secret custom session variable) environment variable not provided."
);

export const app: express.Application = express();

app.use("/companion", companionRouter);
app.use("/openshot", openshotRouter);
app.use("/mediaConvert", mediaConvertRouter);
app.use("/amazonTranscribe", amazonTranscribeRouter);
app.use("/elasticTranscoder", elasticTranscoderRouter);
app.use("/mediaLive", mediaLiveRouter);

app.use("/vonage", vonageRouter);

app.use("/contentItem", contentItemRouter);
app.use("/conferencePrepareJob", conferencePrepareJobRouter);
app.use("/videoRenderJob", videoRenderJobRouter);
app.use("/broadcastContentItem", broadcastContentItemRouter);

app.use("/channels", channelsRouter);

app.get("/", function (_req, res) {
    res.send("Clowdr");
});

app.use(checkEventSecret);

const jsonParser = bodyParser.json();

app.post("/protectedEcho", jsonParser, checkJwt, checkUserScopes, async (_req: Request, res: Response) => {
    const req = _req as AuthenticatedRequest;
    const params: protectedEchoArgs = req.body.input;
    console.log(`Echoing (protected) "${params.message}"`);
    const result = await protectedEchoHandler(req.userId, params);
    return res.json(result);
});

app.post("/echo", jsonParser, async (req: Request, res: Response) => {
    const params: echoArgs = req.body.input;
    console.log(`Echoing "${params.message}"`);
    const result = handlerEcho(params);
    return res.json(result);
});

app.post("/emailCreated", jsonParser, async (req: Request, res: Response) => {
    if (is<Payload>(req.body)) {
        try {
            if (req.body.trigger.name === "EmailCreated" && is<Payload<EmailData>>(req.body)) {
                await handleEmailCreated(req.body);
            } else {
                console.log(`Received unhandled payload: ${req.body.trigger.name}`);
                res.status(400).json("Received unhandled payload");
                return;
            }
        } catch (e) {
            res.status(500).json("Failure while handling event");
            return;
        }
        res.status(200).json("OK");
    } else {
        console.log("Received incorrect payload");
        res.status(500).json("Unexpected payload");
    }
});

app.post("/invitation/send/initial", jsonParser, checkJwt, checkUserScopes, async (_req: Request, res: Response) => {
    const req = _req as AuthenticatedRequest;
    const params: invitationSendInitialEmailArgs = req.body.input;
    console.log("Invitation/send/initial", params);
    const result = await invitationSendInitialHandler(params, req.userId);
    return res.json(result);
});

app.post("/invitation/send/repeat", jsonParser, checkJwt, checkUserScopes, async (_req: Request, res: Response) => {
    const req = _req as AuthenticatedRequest;
    const params: invitationSendRepeatEmailArgs = req.body.input;
    console.log("Invitation/send/repeat", params);
    const result = await invitationSendRepeatHandler(params, req.userId);
    return res.json(result);
});

app.post("/invitation/confirm/current", jsonParser, checkJwt, checkUserScopes, async (_req: Request, res: Response) => {
    const req = _req as AuthenticatedRequest;
    const params: invitationConfirmCurrentArgs = req.body.input;
    console.log("Invitation/confirm/current", params);
    const result = await invitationConfirmCurrentHandler(params, req.userId);
    return res.json(result);
});

app.post("/invitation/confirm/code", jsonParser, checkJwt, checkUserScopes, async (_req: Request, res: Response) => {
    const req = _req as AuthenticatedRequest;
    const params: invitationConfirmWithCodeArgs = req.body.input;
    console.log("Invitation/confirm/code", params);
    const result = await invitationConfirmWithCodeHandler(params, req.userId);
    return res.json(result);
});

app.post(
    "/invitation/confirm/send/initial",
    jsonParser,
    checkJwt,
    checkUserScopes,
    async (_req: Request, res: Response) => {
        const req = _req as AuthenticatedRequest;
        const params: invitationConfirmSendInitialEmailArgs = req.body.input;
        console.log("Invitation/confirm/send/initial", params);
        const result = await invitationConfirmSendInitialEmailHandler(params, req.userId);
        return res.json(result);
    }
);

app.post(
    "/invitation/confirm/send/repeat",
    jsonParser,
    checkJwt,
    checkUserScopes,
    async (_req: Request, res: Response) => {
        const req = _req as AuthenticatedRequest;
        const params: invitationConfirmSendRepeatEmailArgs = req.body.input;
        console.log("Invitation/confirm/send/repeat", params);
        const result = await invitationConfirmSendRepeatEmailHandler(params, req.userId);
        return res.json(result);
    }
);

app.post(
    "/uploaders/sendSubmissionRequests",
    jsonParser,
    checkJwt,
    checkUserScopes,
    async (_req: Request, res: Response) => {
        const req = _req as AuthenticatedRequest;
        const params: uploadSendSubmissionRequestsArgs = req.body.input;
        console.log("Uploaders/sendSubmissionRequests", params);
        const result = await uploadSendSubmissionRequestsHandler(params, req.userId);
        return res.json(result);
    }
);

const portNumber = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
export const server = app.listen(portNumber, function () {
    console.log(`App is listening on port ${process.env.PORT}!`);
    console.log("Initialising AWS client");
    initialiseAwsClient().then(() => {
        console.log("Initialised AWS client");
    });
});
