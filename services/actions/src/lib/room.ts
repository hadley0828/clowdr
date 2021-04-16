import { gql } from "@apollo/client/core";
import { Meeting } from "@aws-sdk/client-chime";
import assert from "assert";
import { is } from "typescript-is";
import {
    ContentGroup_CreateRoomDocument,
    CreateContentGroupRoom_GetContentGroupDocument,
    CreateRoomChimeMeetingDocument,
    DeleteRoomChimeMeetingDocument,
    GetRoomByChimeMeetingIdDocument,
    GetRoomBySessionIdDocument,
    GetRoomChimeMeetingDocument,
    GetRoomConferenceIdDocument,
    GetRoomThatAttendeeCanJoinDocument,
    GetRoomVonageMeetingDocument,
} from "../generated/graphql";
import { apolloClient } from "../graphqlClient";
import { callWithRetry } from "../utils";
import { createChimeMeeting, doesChimeMeetingExist } from "./aws/chime";

export async function createContentGroupBreakoutRoom(contentGroupId: string, conferenceId: string): Promise<string> {
    gql`
        query CreateContentGroupRoom_GetContentGroup($id: uuid!) {
            ContentGroup_by_pk(id: $id) {
                id
                chatId
                conferenceId
                rooms(where: { originatingEventId: { _is_null: true } }, order_by: { created_at: asc }, limit: 1) {
                    id
                }
                title
            }
        }
    `;

    const contentGroupResult = await apolloClient.query({
        query: CreateContentGroupRoom_GetContentGroupDocument,
        variables: {
            id: contentGroupId,
        },
    });

    if (contentGroupResult.data.ContentGroup_by_pk?.conferenceId !== conferenceId) {
        throw new Error("Could not find specified content group in the conference");
    }

    if (contentGroupResult.data.ContentGroup_by_pk.rooms.length > 0) {
        return contentGroupResult.data.ContentGroup_by_pk.rooms[0].id;
    }

    gql`
        mutation ContentGroup_CreateRoom(
            $chatId: uuid = null
            $conferenceId: uuid!
            $name: String!
            $originatingContentGroupId: uuid!
        ) {
            insert_Room_one(
                object: {
                    capacity: 50
                    chatId: $chatId
                    conferenceId: $conferenceId
                    currentModeName: BREAKOUT
                    name: $name
                    originatingContentGroupId: $originatingContentGroupId
                    roomPrivacyName: PUBLIC
                }
            ) {
                id
            }
        }
    `;

    console.log("Creating new breakout room for content group", contentGroupId, conferenceId);

    const createResult = await apolloClient.mutate({
        mutation: ContentGroup_CreateRoomDocument,
        variables: {
            conferenceId: conferenceId,
            name: `${contentGroupResult.data.ContentGroup_by_pk.title}`,
            originatingContentGroupId: contentGroupId,
            chatId: contentGroupResult.data.ContentGroup_by_pk.chatId,
        },
    });
    return createResult.data?.insert_Room_one?.id;
}

export async function getRoomConferenceId(roomId: string): Promise<string> {
    gql`
        query GetRoomConferenceId($roomId: uuid!) {
            Room_by_pk(id: $roomId) {
                id
                conferenceId
            }
        }
    `;

    const room = await apolloClient.query({
        query: GetRoomConferenceIdDocument,
        variables: {
            roomId,
        },
    });

    if (!room.data.Room_by_pk) {
        throw new Error("Could not find room");
    }

    return room.data.Room_by_pk.conferenceId;
}

export async function canUserJoinRoom(attendeeId: string, roomId: string, conferenceId: string): Promise<boolean> {
    gql`
        query GetRoomThatAttendeeCanJoin($roomId: uuid, $attendeeId: uuid, $conferenceId: uuid) {
            Room(
                where: {
                    id: { _eq: $roomId }
                    conference: { attendees: { id: { _eq: $attendeeId } }, id: { _eq: $conferenceId } }
                    _or: [
                        { roomPeople: { attendee: { id: { _eq: $attendeeId } } } }
                        { roomPrivacyName: { _eq: PUBLIC } }
                    ]
                }
            ) {
                id
                publicVonageSessionId
                conference {
                    attendees(where: { id: { _eq: $attendeeId } }) {
                        id
                    }
                }
            }
            FlatUserPermission(
                where: {
                    user: { attendees: { id: { _eq: $attendeeId } } }
                    conference: { id: { _eq: $conferenceId } }
                    permission_name: { _eq: "CONFERENCE_VIEW_ATTENDEES" }
                }
            ) {
                permission_name
            }
        }
    `;
    const result = await callWithRetry(() =>
        apolloClient.query({
            query: GetRoomThatAttendeeCanJoinDocument,
            variables: {
                roomId,
                attendeeId,
                conferenceId,
            },
        })
    );
    return result.data.FlatUserPermission.length > 0 && result.data.Room.length > 0;
}

export async function createRoomChimeMeeting(roomId: string, conferenceId: string): Promise<Meeting> {
    const chimeMeetingData = await createChimeMeeting(roomId);

    gql`
        mutation CreateRoomChimeMeeting(
            $conferenceId: uuid!
            $chimeMeetingData: jsonb!
            $chimeMeetingId: String!
            $roomId: uuid!
        ) {
            insert_room_RoomChimeMeeting_one(
                object: {
                    conferenceId: $conferenceId
                    chimeMeetingData: $chimeMeetingData
                    chimeMeetingId: $chimeMeetingId
                    roomId: $roomId
                }
            ) {
                id
            }
        }
    `;

    try {
        assert(chimeMeetingData.MeetingId);
        await apolloClient.mutate({
            mutation: CreateRoomChimeMeetingDocument,
            variables: {
                conferenceId,
                roomId,
                chimeMeetingData,
                chimeMeetingId: chimeMeetingData.MeetingId,
            },
        });
    } catch (e) {
        console.error("Failed to create a room Chime meeting", { err: e, roomId, conferenceId });
        throw e;
    }

    return chimeMeetingData;
}

export async function getExistingRoomChimeMeeting(roomId: string): Promise<Meeting | null> {
    gql`
        query GetRoomChimeMeeting($roomId: uuid!) {
            room_RoomChimeMeeting(where: { roomId: { _eq: $roomId } }) {
                id
                chimeMeetingData
            }
        }
    `;

    const result = await apolloClient.query({
        query: GetRoomChimeMeetingDocument,
        variables: {
            roomId,
        },
    });

    if (result.data.room_RoomChimeMeeting.length === 1) {
        const roomChimeMeetingId = result.data.room_RoomChimeMeeting[0].id;
        const chimeMeetingData: Meeting = result.data.room_RoomChimeMeeting[0].chimeMeetingData;
        if (!is<Meeting>(chimeMeetingData)) {
            console.warn("Retrieved Chime meeting data could not be validated, deleting record", {
                chimeMeetingData,
                roomId,
            });
            await deleteRoomChimeMeeting(roomChimeMeetingId);
            return null;
        }

        if (!chimeMeetingData.MeetingId || typeof chimeMeetingData.MeetingId !== "string") {
            console.warn("Retrieved Chime meeting data could not be validated, deleting record", {
                chimeMeetingData,
                roomId,
            });
            await deleteRoomChimeMeeting(roomChimeMeetingId);
            return null;
        }

        const exists = await doesChimeMeetingExist(chimeMeetingData.MeetingId);

        if (!exists) {
            console.warn("Chime meeting no longer exists, deleting record", {
                chimeMeetingData,
                roomId,
            });
            await deleteRoomChimeMeeting(roomChimeMeetingId);
            return null;
        }

        return chimeMeetingData;
    }

    return null;
}

export async function getExistingRoomVonageMeeting(roomId: string): Promise<string | null> {
    gql`
        query GetRoomVonageMeeting($roomId: uuid!) {
            Room_by_pk(id: $roomId) {
                id
                publicVonageSessionId
            }
        }
    `;

    const result = await apolloClient.query({
        query: GetRoomVonageMeetingDocument,
        variables: {
            roomId,
        },
    });

    return result.data.Room_by_pk?.publicVonageSessionId ?? null;
}

export async function deleteRoomChimeMeeting(roomChimeMeetingId: string): Promise<void> {
    gql`
        mutation DeleteRoomChimeMeeting($roomChimeMeetingId: uuid!) {
            delete_room_RoomChimeMeeting_by_pk(id: $roomChimeMeetingId) {
                id
            }
        }
    `;
    await apolloClient.mutate({
        mutation: DeleteRoomChimeMeetingDocument,
        variables: {
            roomChimeMeetingId: roomChimeMeetingId,
        },
    });
}

export async function getRoomChimeMeeting(roomId: string, conferenceId: string): Promise<Meeting> {
    const existingChimeMeetingData = await getExistingRoomChimeMeeting(roomId);

    if (existingChimeMeetingData) {
        return existingChimeMeetingData;
    }

    try {
        const chimeMeetingData = await createRoomChimeMeeting(roomId, conferenceId);
        return chimeMeetingData;
    } catch (e) {
        const existingChimeMeetingData = await getExistingRoomChimeMeeting(roomId);
        if (existingChimeMeetingData) {
            return existingChimeMeetingData;
        }

        console.error("Could not get Chime meeting data", { err: e, roomId, conferenceId });
        throw new Error("Could not get Chime meeting data");
    }
}

export async function getRoomVonageMeeting(roomId: string): Promise<string | null> {
    const existingVonageMeetingId = await getExistingRoomVonageMeeting(roomId);

    if (existingVonageMeetingId) {
        return existingVonageMeetingId;
    }

    // todo: create session if appropriate

    return null;
}

export async function getRoomByVonageSessionId(
    sessionId: string
): Promise<{ roomId: string; conferenceId: string } | null> {
    gql`
        query GetRoomBySessionId($sessionId: String!) {
            Room(where: { publicVonageSessionId: { _eq: $sessionId } }) {
                id
                conferenceId
            }
        }
    `;

    const roomResult = await apolloClient.query({
        query: GetRoomBySessionIdDocument,
        variables: {
            sessionId,
        },
    });

    return roomResult.data.Room.length === 1
        ? { roomId: roomResult.data.Room[0].id, conferenceId: roomResult.data.Room[0].conferenceId }
        : null;
}

export async function getRoomByChimeMeetingId(
    meetingId: string
): Promise<{ roomId: string; conferenceId: string } | null> {
    gql`
        query GetRoomByChimeMeetingId($meetingId: String!) {
            Room(where: { roomChimeMeeting: { chimeMeetingId: { _eq: $meetingId } } }) {
                id
                conferenceId
            }
        }
    `;

    const roomResult = await apolloClient.query({
        query: GetRoomByChimeMeetingIdDocument,
        variables: {
            meetingId,
        },
    });

    return roomResult.data.Room.length === 1
        ? { roomId: roomResult.data.Room[0].id, conferenceId: roomResult.data.Room[0].conferenceId }
        : null;
}
