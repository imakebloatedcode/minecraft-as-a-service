package com.imakebloatedcode.velocityrouter;

import com.fasterxml.jackson.annotation.*;

public class ApiReceiveTypes {
    // Base types
    @JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.PROPERTY, property = "type")
    @JsonSubTypes({
            @JsonSubTypes.Type(value = Kick.class, name = "kick"),
            @JsonSubTypes.Type(value = Switch.class, name = "switch")
    })
    public static abstract class BaseCommunication {
        public String type;
    }

    public static abstract class PlayerAction extends BaseCommunication {
        public String userUuid;
    }

    // Api messages
    @JsonTypeName("kick")
    public static class Kick extends PlayerAction {
        public String message;
    }

    @JsonTypeName("switch")
    public static class Switch extends PlayerAction {
        public String serverUuid;
        public String ip;
        public int port;
    }
}
