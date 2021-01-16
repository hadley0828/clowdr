import { gql } from "@apollo/client";
import {
    Badge,
    Button,
    HStack,
    List,
    ListItem,
    Popover,
    PopoverArrow,
    PopoverBody,
    PopoverCloseButton,
    PopoverContent,
    PopoverHeader,
    PopoverTrigger,
    Portal,
    Tooltip,
    useDisclosure,
} from "@chakra-ui/react";
import React, { useMemo } from "react";
import { RoomDetailsFragment, RoomPersonRole_Enum, RoomPrivacy_Enum } from "../../../../generated/graphql";
import { FAIcon } from "../../../Icons/FAIcon";
import useRoomMembers from "../../../Room/useRoomMembers";
import useRoomParticipants from "../../../Room/useRoomParticipants";
import useCurrentUser from "../../../Users/CurrentUser/useCurrentUser";
import { AddRoomPersonModal } from "./AddRoomPersonModal";

export function RoomControlBar({
    roomDetails,
    onSetBackstage,
    backstage,
    hasBackstage,
    breakoutRoomEnabled,
}: {
    roomDetails: RoomDetailsFragment;
    onSetBackstage: (backstage: boolean) => void;
    backstage: boolean;
    hasBackstage: boolean;
    breakoutRoomEnabled: boolean;
}): JSX.Element {
    const user = useCurrentUser();
    const { isOpen, onOpen, onClose } = useDisclosure();
    const roomMembers = useRoomMembers();
    const roomParticipants = useRoomParticipants();

    const thisRoomParticipants = useMemo(
        () => (roomParticipants ? roomParticipants.filter((participant) => participant.roomId === roomDetails.id) : []),
        [roomDetails.id, roomParticipants]
    );

    const roomMembersList = useMemo(
        () => (
            <List>
                {roomMembers ? (
                    [...roomMembers.roomPeople]
                        .sort((x, y) => x.attendee.displayName.localeCompare(y.attendee.displayName))
                        .map((person) => (
                            <ListItem key={person.id}>
                                <FAIcon
                                    icon={
                                        thisRoomParticipants &&
                                        thisRoomParticipants.find(
                                            (participant) => person.attendee.id === participant.attendeeId
                                        )
                                            ? "video"
                                            : "user"
                                    }
                                    iconStyle="s"
                                    mr={5}
                                />
                                {person.attendee.displayName}
                            </ListItem>
                        ))
                ) : (
                    <></>
                )}
            </List>
        ),
        [roomMembers, thisRoomParticipants]
    );

    const roomParticipantsList = useMemo(
        () => (
            <List>
                {thisRoomParticipants ? (
                    thisRoomParticipants.map((participant) => (
                        <ListItem key={participant.id}>
                            <FAIcon icon="video" iconStyle="s" mr={5} />
                            {participant.attendee.displayName}
                        </ListItem>
                    ))
                ) : (
                    <></>
                )}
            </List>
        ),
        [thisRoomParticipants]
    );

    return (
        <HStack justifyContent="flex-end" m={4}>
            {hasBackstage ? (
                backstage ? (
                    <Button colorScheme="red" onClick={() => onSetBackstage(false)}>
                        Hide backstage
                    </Button>
                ) : (
                    <Tooltip label="Backstage is where you can join events as a presenter, session chair or to ask questions.">
                        <Button colorScheme="green" onClick={() => onSetBackstage(true)}>
                            Show backstage
                        </Button>
                    </Tooltip>
                )
            ) : (
                <></>
            )}
            {roomDetails.roomPeople.find(
                (person) =>
                    user.user.attendees.find((myAttendee) => myAttendee.id === person.attendee.id) &&
                    person.roomPersonRoleName === RoomPersonRole_Enum.Admin
            ) ? (
                <Button colorScheme="green" aria-label="Add people to room" title="Add people to room" onClick={onOpen}>
                    <FAIcon icon="plus" iconStyle="s" mr={3} />
                    Add people
                </Button>
            ) : (
                <></>
            )}
            {!breakoutRoomEnabled ? (
                <></>
            ) : roomDetails.roomPrivacyName === RoomPrivacy_Enum.Public ? (
                <Popover>
                    <PopoverTrigger>
                        <Button
                            aria-label={`${
                                thisRoomParticipants ? thisRoomParticipants.length : "0"
                            } People currently in the breakout room`}
                        >
                            <FAIcon icon="users" iconStyle="s" />
                            <Badge ml={2}>{thisRoomParticipants ? thisRoomParticipants.length : "0"} </Badge>
                        </Button>
                    </PopoverTrigger>
                    <Portal>
                        <PopoverContent>
                            <PopoverArrow />
                            <PopoverHeader>Breakout Participants</PopoverHeader>
                            <PopoverCloseButton />
                            <PopoverBody>{roomParticipantsList}</PopoverBody>
                        </PopoverContent>
                    </Portal>
                </Popover>
            ) : (
                <Popover>
                    <PopoverTrigger>
                        <Button aria-label="Members of this room" title="Members of this room">
                            <FAIcon icon="users" iconStyle="s" />
                            <Badge ml={2}>{roomMembers ? roomMembers.roomPeople.length : "0"} </Badge>
                        </Button>
                    </PopoverTrigger>
                    <Portal>
                        <PopoverContent>
                            <PopoverArrow />
                            <PopoverHeader>Room Members</PopoverHeader>
                            <PopoverCloseButton />
                            <PopoverBody>{roomMembersList}</PopoverBody>
                        </PopoverContent>
                    </Portal>
                </Popover>
            )}
            <AddRoomPersonModal roomId={roomDetails.id} isOpen={isOpen} onClose={onClose} />
        </HStack>
    );
}

gql`
    mutation AddParticipantToRoom($attendeeId: uuid!, $roomId: uuid!) {
        insert_RoomPerson_one(object: { attendeeId: $attendeeId, roomId: $roomId, roomPersonRoleName: PARTICIPANT }) {
            id
        }
    }
`;
