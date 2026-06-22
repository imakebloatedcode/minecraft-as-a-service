package com.imakebloatedcode.velocityrouter;

public class ApiSentTypes {
    public static abstract class BaseCommunication {
        public String type;
    }

    public static abstract class PlayerEvent extends BaseCommunication {
        public String username;
        public String userUuid;
    }

    // Api messages
    public static class PlayerConnectionEvent extends PlayerEvent {
        public final String type = "playerConnection";
        public String serverUuid;
    }

    public static class PlayerDisconnectionEvent extends PlayerEvent {
        public final String type = "playerDisconnection";
        public String serverUuid;
    }
}